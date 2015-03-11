'use strict';

var log = require('spm-log');
var fs = require('fs');
var exists = require('fs').existsSync;
var join = require('path').join;
var semver = require('semver');

module.exports = SPMModuleParser;

function SPMModuleParser(cwd, request, callback) {
  log.info('request', JSON.stringify(request));

  var module = {};
  var arr = request.request.split('/');
  module.name = arr[0];
  module.file = arr[1];

  // TODO: 换成 webpack 内部的 module 解析规则
  if (request.path.indexOf('node-libs-browser') > -1) {
    var _pkgPath = join(request.path, 'node_modules', module.name);
    var _pkg = require(join(_pkgPath, 'package.json'));
    var _filepath = join(_pkgPath, _pkg.main || 'index.js');
    log.info('filepath', _filepath);
    return callback(null, {
      path: _filepath,
      query: request.query,
      resolved: true
    });
  }

  var spmModulePath = join(cwd, 'spm_modules/');
  var isRoot = request.path.indexOf(spmModulePath) === -1;
  var currPkg;
  var currPkgPath;
  if (isRoot) {
    var pkgPath = join(cwd, 'package.json');
    if (exists(pkgPath)) {
      currPkgPath = cwd;
      currPkg = require(join(currPkgPath, 'package.json'));
    }
  } else {
    var pkgArr = request.path.split(spmModulePath)[1].split('/');
    currPkgPath = join(spmModulePath, pkgArr[0], pkgArr[1]);
    currPkg = require(join(currPkgPath, 'package.json'));
  }

  var filepath;

  if (currPkg && currPkg.name === module.name) {
    filepath = join(currPkgPath, module.file || currPkg.spm.main || 'index.js');
    log.info('filepath', filepath);
    return callback(null, {
      path: filepath,
      query: request.query,
      resolved: true
    });
  }

  var expectVersion;
  if (currPkg && currPkg.spm && currPkg.spm.dependencies && currPkg.spm.dependencies[module.name]) {
    expectVersion = currPkg.spm.dependencies[module.name];
  } else if (isRoot) {
    expectVersion = '*';
  } else {
    return callback('module ' + module.name + ' not found');
  }

  var versionObj = getVersion(expectVersion, join(spmModulePath, module.name));
  if (!versionObj) {
    return callback('version ' + expectVersion + ' not found');
  }

  module.path = versionObj.path;
  module.pkg = versionObj.pkg;
  module.version = versionObj.version;

  // TODO: file 可能需要补充后缀
  filepath = join(module.path, module.file || module.pkg.spm.main || 'index.js');
  log.info('filepath', filepath);

  callback(null, {
    path: filepath,
    query: request.query,
    resolved: true
  });
}

function getVersion(version, dest) {
  if (!exists(dest)) return;

  var map = {};
  var dirs = fs.readdirSync(dest);
  var versions = dirs
    .filter(filterDir)
    .map(getPkgVersion)
    .filter(semver.valid)
    .sort(semver.rcompare);
  var ret = semver.maxSatisfying(versions, version);
  if (ret) {
    return {
      version: ret,
      path: map[ret].path,
      pkg: map[ret].pkg
    };
  }

  return ret;

  function getPkgVersion(dir) {
    var pkg = require(join(dest, dir, 'package.json'));
    var ver = pkg.version;
    map[ver] = {
      path: join(dest, dir),
      pkg: pkg
    };
    return ver;
  }

  function filterDir(dir) {
    return fs.statSync(join(dest, dir)).isDirectory();
  }
}