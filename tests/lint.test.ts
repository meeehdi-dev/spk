import { execFile, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'

import { ESLint } from 'eslint'
import { afterAll, describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')
const fixtures = mkdtempSync(join(root, 'tests/.lint-'))
const eslint = new ESLint({ cwd: root })
afterAll(() => rmSync(fixtures, { recursive: true, force: true }))

describe('hybrid linting', () => {
  it('checks promises, unused variables, Nuxt conventions and class variables in Oxlint', () => {
    const file = join(fixtures, 'probe.ts')
    writeFileSync(
      file,
      "const unused = 1\nconst _ignored = 2\nconst classes = 'p-4 flex flex p-2'\nPromise.resolve()\nif (process.client) console.log(classes)\n",
    )
    const result = spawnSync(process.execPath, [join(root, 'node_modules/oxlint/bin/oxlint'), '--type-aware', '--no-ignore', file], {
      cwd: root,
      encoding: 'utf8',
    })
    const output = result.stdout + result.stderr
    expect(result.status, output).toBe(1)
    expect(output).toContain('no-unused-vars')
    expect(output).not.toContain("Variable '_ignored'")
    expect(output).toContain('no-floating-promises')
    expect(output).toContain('prefer-import-meta')
    expect(output).toContain('enforce-consistent-class-order')
    expect(output).toContain('no-duplicate-classes')
    expect(output).toContain('no-conflicting-classes')
  }, 15000)

  it('keeps template-aware variable and promise checks in ESLint', async () => {
    const [result] = await eslint.lintText(
      `<script setup lang="ts">
const unused = 1
const _ignored = 2
const shown = 'hello'
Promise.resolve()
</script>
<template>
  <div class="flex flex p-2 p-4" :class="shown ? 'block block m-2 m-4' : 'flex'" />
  <UCard :ui="{ base: 'flex flex p-2 p-4' }" />
  <UCard v-bind:ui="{ base: 'flex flex p-2 p-4' }" />
  <div v-html="shown" />
</template>`,
      { filePath: join(root, 'app/components/chat/AttachmentView.vue') },
    )
    expect(result!.messages.map(message => message.ruleId)).toEqual(
      expect.arrayContaining(['@typescript-eslint/no-unused-vars', '@typescript-eslint/no-floating-promises', 'vue/no-v-html']),
    )
    expect(result!.messages.filter(message => message.ruleId === '@typescript-eslint/no-unused-vars').map(message => message.message)).toHaveLength(1)
    expect(result!.messages.filter(message => message.ruleId === 'better-tailwindcss/no-duplicate-classes')).toHaveLength(4)
    expect(result!.messages.filter(message => message.ruleId === 'better-tailwindcss/no-conflicting-classes')).toHaveLength(8)
    expect(result!.messages.filter(message => message.ruleId?.startsWith('better-tailwindcss/')).every(message => message.severity === 2)).toBe(true)
  }, 15000)

  it('allows repeated classes in independent slots, conditional branches and responsive variants', async () => {
    const [result] = await eslint.lintText(
      `<script setup lang="ts">\nconst wide = true\n</script>\n<template><UCard :ui="{ base: 'flex p-2', body: 'flex p-4', content: wide ? 'flex' : 'flex' }" /><div class="p-2 md:p-4" /></template>`,
      { filePath: join(root, 'app/components/chat/PreviewCard.vue') },
    )
    expect(result!.messages.filter(message => message.ruleId?.startsWith('better-tailwindcss/'))).toEqual([])
  }, 15000)

  it('sorts Vue imports and static and bound classes with Oxfmt, then stays stable', async () => {
    const input =
      '<script setup lang="ts">\nimport z from "z"\nimport a from "a"\n</script>\n<template><div class="p-4 flex flex" :class="[\'p-4 flex\', { \'p-4 flex\': true }]" /><UCard :ui="{ base: \'p-4 flex\', body: true ? \'p-4 flex\' : \'block\' }" /></template>\n'
    const args = [join(root, 'node_modules/oxfmt/bin/oxfmt'), '--stdin-filepath', 'tests/Probe.vue']
    const format = (input: string) => {
      const result = promisify(execFile)(process.execPath, args, { cwd: root, encoding: 'utf8' })
      result.child.stdin!.end(input)
      return result
    }
    const { stdout: formatted } = await format(input)
    expect(formatted.indexOf("from 'a'")).toBeLessThan(formatted.indexOf("from 'z'"))
    expect(formatted).not.toContain('p-4 flex')
    expect(formatted).toContain('flex p-4')
    expect(formatted).toContain('flex flex p-4')
    expect((await format(formatted)).stdout).toBe(formatted)
  }, 15000)
})
