'use strict';
import test from 'ava';
import getStream from 'get-stream';
import {fork} from 'child_process';

// setTimeout as a Promise. Use it to delay via `await`
function tick(time) {
	time = time || 0;

	if (process.env.TRAVIS) {
		// slow things down for reliable tests on Travis-CI
		time *= 10;
	}

	return new Promise(resolve => setTimeout(resolve, time));
}

test.beforeEach(t => {
	const child = fork('fixture.js', {silent: true});

	const exit = new Promise((resolve) =>
		child.on('exit', code => {
			console.log('exited with ' + code);
			resolve(code);
		})
	);

	t.context = {
		// tell the child to create a promise, and reject it
		rejectWithError: (key, message) => child.send({action: 'reject-error', key, message}),
		rejectWithValue: (key, value) => child.send({action: 'reject-value', key, value}),
		rejectWithNothing: key => child.send({action: 'reject-nothing', key}),

		// tell the child to handle the promise previously rejected
		handle: key => child.send({action: 'handle', key}),

		// tell the child to reinstall loudRejection
		reinstall: (opts) => child.send({action: 'reinstall', opts}),

		// kill the child (returns a promise for when the child is done)
		kill: () => {
			child.kill();
			return exit;
		},

		exitWith: code => {
			child.send({action: 'exitWith', code});
			return exit;
		},

		// the stdout of the child. Useful for debug
		stdout: getStream(child.stdout),

		// the stderr of the child. This is where unhandledRejections will be logged
		stderr: getStream(child.stderr),

		// promise for when the child has exited
		exit
	};

	child.on('message', message => {
		if (message.status !== 'ready') {
			t.fail(`I got a message I don't understand: ${JSON.stringify(message)}`);
		}

		t.end();
	});
});

test('no rejections', async t => {
	const child = t.context;

	await tick(20);
	await child.kill();

	t.is(await child.stderr, '');
});

test('one unhandled rejection', async t => {
	const child = t.context;

	child.rejectWithError('a', 'foo123');
	await tick(20);
	await child.kill();

	t.true(/foo123/.test(await child.stderr));
});

test('two unhandled rejections', async t => {
	const child = t.context;

	child.rejectWithError('a', 'foo456');
	child.rejectWithError('b', 'bar789');
	await tick(20);
	await child.kill();

	t.true(/foo456/.test(await child.stderr));
	t.true(/bar789/.test(await child.stderr));
});

test('one rejection that is handled before exit', async t => {
	const child = t.context;

	child.rejectWithError('a', 'foo123');
	await tick(20);
	child.handle('a');
	await tick(20);
	await child.kill();

	t.is(await child.stderr, '');
});

test('two rejections, first one handled', async t => {
	const child = t.context;

	child.rejectWithError('a', 'foo987');
	child.rejectWithError('b', 'bar654');
	await tick(20);
	child.handle('a');
	await tick(20);
	await child.kill();

	t.false(/foo987/.test(await child.stderr));
	t.true(/bar654/.test(await child.stderr));
});

test('two rejections, last one handled', async t => {
	const child = t.context;

	child.rejectWithError('a', 'foo987');
	child.rejectWithError('b', 'bar654');
	await tick(20);
	child.handle('b');
	await tick(20);
	await child.kill();

	t.true(/foo987/.test(await child.stderr));
	t.false(/bar654/.test(await child.stderr));
});

test('rejection with a string value', async t => {
	const child = t.context;

	child.rejectWithValue('a', 'foo123');
	await tick(20);
	await child.kill();

	t.true(/Promise rejected with value: foo123/.test(await child.stderr));
});

test('rejection with a falsy value', async t => {
	const child = t.context;

	child.rejectWithValue('a', false);
	child.rejectWithValue('a', 0);
	await tick(20);
	await child.kill();

	t.true(/Promise rejected with value: false/.test(await child.stderr));
	t.true(/Promise rejected with value: 0/.test(await child.stderr));
});

test('rejection with no value', async t => {
	const child = t.context;

	child.rejectWithNothing();
	await tick(20);
	await child.kill();

	t.true(/Promise rejected no value/.test(await child.stderr));
});

test('will warn if installed twice', async t => {
	const child = t.context;

	child.reinstall();
	await tick(20);
	await child.kill();

	t.true(/WARN: loud rejection called more than once/.test(await child.stderr));
});

test('unhandledRejections will cause an exitCode of 1 by default', async t => {
	const child = t.context;

	child.rejectWithError('a', 'boo');
	await tick(20);
	var exitCode = child.exitWith(0);

	t.is(await exitCode, 1);
});

test('exitCode can be manipulated', async t => {
	const child = t.context;

	child.reinstall({exitCode: 20});
	child.rejectWithError('a', 'boo');
	await tick(20);
	var exitCode = child.exitWith(0);

	t.is(await exitCode, 20);
});

test('will not manipulate non-zero exit codes', async t => {
	const child = t.context;

	child.reinstall({exitCode: 20});
	child.rejectWithError('a', 'boo');
	await tick(20);
	var exitCode = child.exitWith(10);

	t.is(await exitCode, 10);
});

test('will throw if opts.exitCode is less than 0', async t => {
	const child = t.context;

	child.reinstall({exitCode: -1});

	t.true(await child.exit > 0);
	t.true(/opts\.exitCode can't be a negative number/.test(await child.stderr));
});

test('will throw if opts.exitCode is modified more than once', async t => {
	const child = t.context;

	child.reinstall({exitCode: 2});
	child.reinstall({exitCode: 3});

	t.true(await child.exit > 0);
	t.true(/two callers have tried to modify the exit code/.test(await child.stderr));
});
