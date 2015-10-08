// Copyright 2015 Joyent, Inc.

module.exports = PrivateKey;

var assert = require('assert-plus');
var algs = require('./algs');
var crypto = require('crypto');
var Fingerprint = require('./fingerprint');
var Signature = require('./signature');
var errs = require('./errors');
var util = require('util');

var Key = require('./key');

var InvalidAlgorithmError = errs.InvalidAlgorithmError;
var KeyParseError = errs.KeyParseError;

var formats = {};
formats['auto'] = require('./formats/auto');
formats['pem'] = require('./formats/pem');
formats['pkcs1'] = require('./formats/pkcs1');
formats['pkcs8'] = require('./formats/pkcs8');
formats['rfc4253'] = require('./formats/rfc4253');
formats['ssh-private'] = require('./formats/ssh-private');
formats['openssh'] = formats['ssh-private'];
formats['ssh'] = formats['ssh-private'];

function PrivateKey(opts) {
	assert.object(opts, 'options');
	Key.call(this, opts);

	this._pubCache = undefined;
	Object.defineProperty(this, '_pubCache', {writable: true});
}
util.inherits(PrivateKey, Key);

PrivateKey.formats = formats;

PrivateKey.prototype.toBuffer = function (format) {
	if (format === undefined)
		format = 'pkcs1';
	assert.string(format, 'format');
	assert.object(formats[format], 'formats[format]');

	return (formats[format].write(this));
};

PrivateKey.prototype.hash = function (algo) {
	return (this.toPublic().hash(algo));
};

PrivateKey.prototype.toPublic = function () {
	if (this._pubCache)
		return (this._pubCache);

	var algInfo = algs.info[this.type];
	var pubParts = [];
	for (var i = 0; i < algInfo.parts.length; ++i) {
		var p = algInfo.parts[i];
		pubParts.push(this.part[p]);
	}

	this._pubCache = new Key({
		type: this.type,
		source: this,
		parts: pubParts
	});
	return (this._pubCache);
};

PrivateKey.prototype.createVerify = function (hashAlgo) {
	return (this.toPublic().createVerify(hashAlgo));
};

PrivateKey.prototype.createSign = function (hashAlgo) {
	if (hashAlgo === undefined) {
		hashAlgo = 'sha1';
		if (this.type === 'rsa')
			hashAlgo = 'sha256';
		if (this.type === 'ecdsa') {
			if (this.size <= 256)
				hashAlgo = 'sha256';
			else if (this.size <= 384)
				hashAlgo = 'sha384';
			else
				hashAlgo = 'sha512';
		}
	}
	assert.string(hashAlgo, 'hash algorithm');
	var v, nm, err;
	try {
		nm = this.type.toUpperCase() + '-';
		if (this.type === 'ecdsa')
			nm = 'ecdsa-with-';
		nm += hashAlgo.toUpperCase();
		v = crypto.createSign(nm);
	} catch (e) {
		err = e;
	}
	if (v === undefined || (err instanceof Error &&
	    err.message.match(/Unknown message digest/))) {
		nm = 'RSA-';
		nm += hashAlgo.toUpperCase();
		v = crypto.createSign(nm);
	}
	assert.ok(v, 'failed to create verifier');
	var oldSign = v.sign.bind(v);
	var key = this.toBuffer('pkcs1');
	var type = this.type;
	v.sign = function () {
		var sig = oldSign(key);
		if (typeof (sig) === 'string')
			sig = new Buffer(sig, 'binary');
		sig = Signature.parse(sig, type, 'asn1');
		sig.hashAlgorithm = hashAlgo;
		return (sig);
	};
	return (v);
};

PrivateKey.parse = function (data, format, name) {
	if (typeof (data) !== 'string')
		assert.buffer(data, 'data');
	if (format === undefined)
		format = 'auto';
	assert.string(format, 'format');
	if (name === undefined)
		name = '(unnamed)';

	assert.object(formats[format], 'formats[format]');

	try {
		var k = formats[format].read(data);
		assert.ok(k instanceof PrivateKey);
		if (!k.comment)
			k.comment = name;
		return (k);
	} catch (e) {
		throw (new KeyParseError(name, format, e));
	}
};