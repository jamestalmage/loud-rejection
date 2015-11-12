'use strict';
var onExit = require('signal-exit');
var installed = false;

// -1 signals the default exit code (which is 1).
var exitCode = -1;

function outputRejectedMessage(err) {
	if (err instanceof Error) {
		console.error(err.stack);
	} else if (typeof err === 'undefined') {
		console.error('Promise rejected no value');
	} else {
		console.error('Promise rejected with value:', err);
	}
}

module.exports = function (opts) {
	var unhandledRejections = [];
	opts = opts || {};

	if (typeof opts.exitCode === 'number') {
		if (opts.exitCode < 0) {
			throw new Error('loud-rejection: opts.exitCode can\'t be a negative number: ' + opts.exitCode);
		}
		if (exitCode >= 0 && exitCode !== opts.exitCode) {
			throw new Error('loud-rejection: two callers have tried to modify the exit code: ' + exitCode + ', ' + opts.exitCode);
		}
		exitCode = opts.exitCode;
	}

	if (installed) {
		console.trace('WARN: loud rejection called more than once');
		return;
	}

	installed = true;

	process.on('unhandledRejection', function (reason, p) {
		unhandledRejections.push({reason: reason, p: p});
	});

	process.on('rejectionHandled', function (p) {
		var index = unhandledRejections.reduce(function (result, item, idx) {
			return (item.p === p ? idx : result);
		}, -1);

		unhandledRejections.splice(index, 1);
	});

	onExit(function () {
		if (unhandledRejections.length > 0) {
			unhandledRejections.forEach(function (x) {
				outputRejectedMessage(x.reason);
			});

			// Do not modify non-zero exit codes
			if (process.exitCode > 0) {
				return;
			}

			process.exitCode = exitCode === -1 ? 1 : exitCode;
		}
	});
};
