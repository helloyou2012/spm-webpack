'use strict';

require('colorful').colorful();

var join = require('path').join;
var copy = require('fs-extra').copySync;
var exists = require('fs').existsSync;
var readFile = require('fs').readFileSync;
var rimraf = require('rimraf');
var log = require('spm-log');
var webpack = require('webpack');
var ExtractTextPlugin = require('extract-text-webpack-plugin');
var qs = require('qs');

var SPMWebpackPlugin = require('./SPMWebpackPlugin');
var FixCSSPathPlugin = require('./FixCSSPathPlugin');
var getFiles = require('./getFiles');
var getArgs = require('./getArgs');

var co = require('co');
var install = co(require('spm-client/lib/install'));

var utils = require('./utils');
var normalize = utils.normalizeLoader;

module.exports = function build(opts, callback) {
  getWebpackOpts(opts, function(err, webpackOpts) {
    // build
    var compiler = webpack(webpackOpts);
    compiler.plugin('compile', function() {
      log.info('build', 'compile');
    });
    compiler.plugin('done', function(stats) {
      printResult(stats, opts);
      log.info('build', 'done');
      if (webpackOpts.files.other.length) copyFiles(webpackOpts.files.other, webpackOpts.output.path, webpackOpts.pkg, opts.cwd);

      if (callback) {
        callback(null, stats);
      }
    });

    if (opts.watch) {
      compiler.watch(200, function(err) {
        if (err) log.error('error', err);
      });
    } else {
      compiler.run(function(err) {
        if (err) log.error('error', err);
      });
    }
  });
};

Object.defineProperty(module.exports, 'getWebpackOpts', {
  get: function() {
    return getWebpackOpts;
  }
});

function getWebpackOpts(opts, callback) {
  var cwd = opts.cwd = opts.cwd || process.cwd();

  log.config({quiet: opts.quiet, verbose: opts.verbose});

  // Get pkg.
  var pkg = opts.pkg;
  if (!pkg && exists(join(cwd, 'package.json'))) {
    pkg = JSON.parse(readFile(join(cwd, 'package.json'), 'utf-8'));
  }

  opts = getArgs(opts, pkg);


  // Get deps to install.
  var query = [];
  if (pkg && pkg.spm && pkg.spm.dependencies) {
    for (var k in pkg.spm.dependencies) {
      query.push(k+'@'+pkg.spm.dependencies[k]);
    }
  }

  install({
    name: query,
    cwd: cwd,
    force: opts.build.force,
    registry: pkg && pkg.spm && pkg.spm.registry
  }, function(err) {
    if (err) {
      log.error('exit', err.message);
      console.log();
      process.exit(1);
    }

    var css = '';
    var spmcss = 'spmcss';
    if (!opts.build.debug) spmcss = spmcss + '?minimize';
    if (opts.build.autoprefixer) css = css + '!autoprefixer';
    css = normalize(css, opts, 'css');
    if (css.charAt(0) !== '!') css = '!' + css;
    css = spmcss + css;
    var cssLoader = 'style!' + css;
    var lessLoader = 'style!' + normalize(css+'!less', opts, 'less');
    if (opts.build.extractCSS) {
      cssLoader = ExtractTextPlugin.extract('style', css);
      lessLoader = ExtractTextPlugin.extract('style', normalize(css+'!less', opts, 'less'));
    }

    var babelOpts = decodeURI(qs.stringify(opts.build.babel, {arrayFormat:'brackets'}));
    if (babelOpts) babelOpts = '?' + babelOpts;
    var babel = opts.build.babel ? ('babel'+babelOpts+'!') : '';
    var name = opts.build.hash ? '[name]-[hash]' : '[name]';

    var loader = 'file';
    if (opts.build.base64) {
      var urlOpts = decodeURI(qs.stringify(opts.build.base64, {arrayFormat: 'brackets'}));
      loader = 'url';
      if (urlOpts) {
        loader = loader + '?' + urlOpts;
      }
    }

    var args = {
      resolveLoader: {
        root: join(__dirname, '../node_modules')
      },
      output: {
        path: opts.build.dest || 'dist',
        filename: name + '.js',
        chunkFilename: name + '.js'
      },
      module: {
        loaders: [
          { test: /\.json$/, loader: normalize(babel + 'json', opts, 'json') },
          { test: /\.js$/, loader: normalize(babel + 'jsx2?harmony', opts, 'js') },
          { test: /\.coffee$/, loader: normalize('jsx2?harmony!coffee', opts, 'coffee') },
          { test: /\.jsx$/, loader: normalize('jsx2?harmony', opts, 'jsx') },
          { test: /\.tpl$/, loader: normalize('spmtpl', opts, 'tpl') },
          { test: /\.atpl$/, loader: normalize('atpl', opts, 'atpl') },
          { test: /\.handlebars$/, loader: normalize('handlebars?helperDirs[]=' + __dirname + '/../helpers', opts, 'handlebars') },
          { test: /\.css$/, loader: cssLoader },
          { test: /\.less$/, loader: lessLoader },
          { test: /\.(png|jpe?g|gif|eot|svg|ttf|woff)$/, loader: loader }
        ]
      },
      plugins: [
        new SPMWebpackPlugin(cwd),
        new webpack.IgnorePlugin(/^\.\/locale$/, [/moment$/]),
        new FixCSSPathPlugin()
      ]
    };

    if (opts.build.extractCSS) {
      args.plugins.push(new ExtractTextPlugin(name + '.css', {
        disable: false,
        allChunks: true
      }));
    }

    if (opts.build.define && typeof opts.build.define === 'object') {
      args.plugins.push(new webpack.DefinePlugin(opts.build.define));
    }

    var files;
    if (opts.build.entry) {
      files = getFiles(cwd, {spm:{output:opts.build.entry}});
    } else {
      files = getFiles(cwd, pkg);
    }
    args.files = files;
    args.entry = files.js;

    if (opts.build.umd) {
      args.output.library = opts.build.umd;
      args.output.libraryTarget = 'umd';
    }

    if (opts.build.vendor) {
      args.entry.vendor = opts.build.vendor;
      args.plugins.push(new webpack.optimize.CommonsChunkPlugin('vendor', 'vendor.bundle.js'));
    }

    if (opts.build.common) {
      args.plugins.push(new webpack.optimize.CommonsChunkPlugin('common.js'));
    }

    if (!opts.build.debug) {
      args.plugins.push(new webpack.optimize.UglifyJsPlugin(opts.build.uglify));
    }

    args.externals = opts.build.global;

    require('./logArgs')(args);
    require('./logArgs')(opts);

    // clean first
    if (opts.build.clean) {
      rimraf.sync(args.output.path);
      log.info('clean', args.output.path);
    }

    args.pkg = pkg;

    callback(null, args);
  });
}

function printResult(stats, opts) {
  log.debug('stats', '\n' + stats.toString());

  var errors = stats.compilation.errors;
  if (errors && errors.length) {
    errors.forEach(function (err) {
      log.error('error', err.message);
    });
    if (!opts.watch) {
      console.log();
      process.exit(1);
    }
  }

  stats = stats.toJson();
  stats.assets.forEach(function(item) {
    var size = (item.size/1024.0).toFixed(2) + 'kB';
    log.info('generated', item.name, size.to.magenta.color);
  });
}

function copyFiles(files, destDir, pkg, cwd) {
  files.forEach(function(file) {
    var destFile = join(destDir, utils.getPrefix(pkg), file);
    var err = copy(join(cwd, file), destFile);
    if (err) {
      log.error('copy', err);
    } else {
      log.info('copy', utils.getPrefix(pkg) + file);
    }
  });
}
