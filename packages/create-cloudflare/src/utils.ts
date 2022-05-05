import * as fs from 'fs';
import { tmpdir } from 'os';
import { promisify } from 'util';
import { join, relative } from 'path';
import { exec } from 'child_process';
import semiver from 'semiver';

import type { Argv } from 'create-cloudflare';

export const run = promisify(exec);
export const exists = fs.existsSync;

export { join, relative };

export async function rmdir(dir: string): Promise<void> {
	if (exists(dir)) fs.promises.rm(dir, { recursive: true });
}

export const git = (...args: string[]) => run(`git ${args.join(' ')}`);

export const rand = () => Math.random().toString(16).substring(2);

// allows [user@]host.xz:path/to/repo.git/
export const isRemote = (str: string) => /^(https?|ftps?|file|git|ssh):\/\//.test(str) || str.includes(':');

export interface Remote {
	source: string;
	filter?: string;
}

// TODO: if debug, add err.stack information
export async function clone(remote: Remote, dest: string, argv: Argv) {
	let args = ['clone --depth 1'];
	let { source, filter } = remote;
	let target=dest, sparse=false;

	try {
		var { stdout } = await git('version');
	} catch (err) {
		throw 'Missing `git` executable';
	}

	let [version] = /\d+.\d+.\d+/.exec(stdout) || [];
	if (!version) throw 'Unknown `git` version';

	if (filter) {
		let num = semiver(version, '2.26.0');
		sparse = num !== -1; // -1~>lesser; 0~>equal; 1~>greater

		target = join(tmpdir(), rand() + '-' + rand());

		// @see https://stackoverflow.com/a/52269934/3577474
		if (sparse) args.push('--filter=blob:none --sparse');
	}

	let idx = source.lastIndexOf('#');

	if (idx === -1) {
		if (source.includes('worker-examples')) {
			args.push('-b dev'); // TODO remove me
		}
		args.push(source);
	} else {
		args.push(`-b ${source.substring(idx + 1)}`);
		args.push(source.substring(0, idx));
	}

	try {
		args.push(target);
		await git(...args);
	} catch (err) {
		throw `Error cloning "${source}" repository`;
	}

	if (filter) {
		// sparse keeps the {filter} structure, so w/o
		// the tmpdir() juggle, we would have {target}/{filter} result
		// @see https://git-scm.com/docs/git-sparse-checkout/2.26.0
		if (sparse) await run(`git sparse-checkout set "${filter}"`, { cwd: target });

		// effectively `$ mv {tmp/filter} {dest}
		await fs.promises.rename(join(target, filter), dest);
		await rmdir(target); // rm -rf tmpdir
	}

	// cleanup phase

	await rmdir(join(dest, '.git'));

	if (argv.init) {
		args = ['init'];
		// https://git-scm.com/docs/git-init/2.28.0
		idx = semiver(version, '2.26.0');
		if (idx !== -1) args.push('-b main');
		try {
			await git(...args, dest);
		} catch (err) {
			throw `Error initializing repository`;
		}
	}
}