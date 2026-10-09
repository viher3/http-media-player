import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { normalizeRel, resolveInside } from '../src/paths.js'

test('normalizeRel', () => {
  assert.equal(normalizeRel('a//b/./c'), 'a/b/c')
  assert.equal(normalizeRel(''), '')
  assert.equal(normalizeRel('../etc'), null)
  assert.equal(normalizeRel('a/../../b'), null)
  assert.equal(normalizeRel('a\\..\\b'), null)
  assert.equal(normalizeRel('a\0b'), null)
})

test('resolveInside bloquea symlinks que escapan', () => {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'paths-')))
  const root = path.join(tmp, 'root'); const outside = path.join(tmp, 'outside')
  fs.mkdirSync(root); fs.mkdirSync(outside)
  fs.writeFileSync(path.join(outside, 'secret.mp3'), 'x')
  fs.writeFileSync(path.join(root, 'ok.mp3'), 'x')
  fs.symlinkSync(outside, path.join(root, 'link'))
  assert.equal(resolveInside(root, 'ok.mp3'), path.join(root, 'ok.mp3'))
  assert.equal(resolveInside(root, 'link/secret.mp3'), null)
  assert.equal(resolveInside(root, '../outside/secret.mp3'), null)
  assert.equal(resolveInside(root, 'nope'), null)
})
