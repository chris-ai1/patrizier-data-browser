// Authors: Christian Reitwiessner
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
execFileSync('cargo', ['build', '--locked', '--release', '--target', 'wasm32-unknown-unknown', '--lib'], { cwd: 'engine', stdio: 'inherit' });
rmSync('dist', { recursive: true, force: true });
mkdirSync('dist');
cpSync('public', 'dist', { recursive: true });
cpSync('engine/target/wasm32-unknown-unknown/release/patrizier.wasm', 'dist/patrizier.wasm');
cpSync('LICENSE', 'dist/LICENSE.txt');
cpSync('THIRD_PARTY.md', 'dist/THIRD_PARTY.txt');
console.log('Static application built in dist/. No game data is included.');
