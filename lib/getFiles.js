'use strict';

var join = require('path').join;
var exists = require('fs').existsSync;
var stat = require('fs').statSync;
var uniq = require('uniq');
var glob = require('glob');
var extname = require('path').extname;
var utils = require('./utils');

module.exports = function(cwd, pkg) {
  var files = [];

  if (exists(join(cwd, pkg.spm.main || 'index.js'))) {
    files.push((pkg.spm.main || 'index.js').replace(/^\.\//g, ''));
  }

  (pkg.spm.output || []).forEach(function(pattern) {
    var items = glob.sync(pattern, {cwd: cwd});
    items.forEach(function(item) {
      if (stat(join(cwd, item)).isFile()) {
        files.push(item);
      }
    });
  });

  return map(uniq(files), cwd, pkg);
};

function map(files, cwd, pkg) {
  var js = {};
  var css = {};
  var other = [];
  var prefix = utils.getPrefix(pkg);
  files.forEach(function(file) {
    var absFile = join(cwd, file);
    var ext = extname(file);
    if (ext === '.js' || ext === '.coffee' || ext === '.jsx') {
      js[prefix + file.replace(ext, '')] = absFile;
    } else if (ext === '.css') {
      css[prefix + file.replace(ext, '')] = absFile;
    } else {
      other.push(file);
    }
  });
  return {js:js,other:other};
}
