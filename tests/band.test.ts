import { describe, expect, mock, test } from 'claude-code/testing'

import {
  colorFor,
  hasReset,
  hostLabel,
  parseMeminfo,
  ramColorFor,
  ramShown,
  readingAge,
  untilReset,
} from '../hooks/register'

const SSH = '198.51.100.7 49992 192.0.2.10 22'
const TOTAL_KB = 3885816 // MemTotal of a small (~3.7 GiB) VM

function meminfo(availableKb: number): string {
  return [
    `MemTotal:        ${TOTAL_KB} kB`,
    'MemFree:          140584 kB',
    `MemAvailable:    ${availableKb} kB`,
    'Buffers:          136528 kB',
    '',
  ].join('\n')
}

const PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 10,
  bodyColumns: 160,
  scroll: { offset: 0, bodyRows: 9 },
  view: {},
}

describe('helpers', () => {
  test('hostLabel', () => {
    expect(hostLabel('devbox', SSH)).toBe('SSH devbox (192.0.2.10)')
    expect(hostLabel('devbox', undefined)).toBe('devbox')
    expect(hostLabel('', SSH)).toBe('SSH 192.0.2.10')
  })

  test('parseMeminfo', () => {
    expect(parseMeminfo(meminfo(2763084))).toEqual({ totalKb: TOTAL_KB, availableKb: 2763084 })
    expect(parseMeminfo('')).toBeNull()
  })

  test('ramColorFor: yellow under 30 % free, orange under 20 %, red under 10 %, strictly below', () => {
    expect(ramColorFor(30)).toBe('green')
    expect(ramColorFor(29.9)).toBe('yellow')
    expect(ramColorFor(20)).toBe('yellow')
    expect(ramColorFor(19.9)).toBe('#ff8700')
    expect(ramColorFor(10)).toBe('#ff8700')
    expect(ramColorFor(9.9)).toBe('red')
  })

  test('colorFor: yellow from 70 % used, orange from 80 %, red from 90 %', () => {
    expect(colorFor(69.9)).toBe('green')
    expect(colorFor(70)).toBe('yellow')
    expect(colorFor(79.9)).toBe('yellow')
    expect(colorFor(80)).toBe('#ff8700')
    expect(colorFor(89.9)).toBe('#ff8700')
    expect(colorFor(90)).toBe('red')
  })

  test('untilReset is short: ↻ then the time left', () => {
    const t = Date.parse('2026-10-06T23:00:00Z')
    expect(untilReset('2026-10-13T13:00:00Z', t)).toBe('↻ 6d')
    expect(untilReset('2026-10-07T23:00:00Z', t)).toBe('↻ 1d')
    expect(untilReset('2026-10-07T22:59:00Z', t)).toBe('↻ 23h 59m')
    expect(untilReset('2026-10-07T04:00:00Z', t)).toBe('↻ 5h 0m')
    expect(untilReset('2026-10-06T23:42:00Z', t)).toBe('↻ 42m')
    expect(untilReset('2026-10-06T23:00:00Z', t)).toBeUndefined()
    expect(untilReset('2026-10-06T22:00:00Z', t)).toBeUndefined()
    expect(untilReset(undefined, t)).toBeUndefined()
  })

  test('hasReset once the reset time is reached, never before the clock has ticked', () => {
    const t = Date.parse('2026-10-06T23:00:00Z')
    expect(hasReset('2026-10-06T23:00:01Z', t)).toBe(false)
    expect(hasReset('2026-10-06T23:00:00Z', t)).toBe(true)
    expect(hasReset('2026-10-06T22:00:00Z', t)).toBe(true)
    expect(hasReset('2026-10-06T22:00:00Z', 0)).toBe(false)
    expect(hasReset(undefined, t)).toBe(false)
  })

  test('readingAge shows from 5 minutes, floored', () => {
    const t = Date.parse('2026-10-06T23:00:00Z')
    expect(readingAge(t - 4 * 60_000 - 59_000, t)).toBeUndefined()
    expect(readingAge(t - 5 * 60_000, t)).toBe('5m ago')
    expect(readingAge(t - 40 * 60_000 - 59_000, t)).toBe('40m ago')
    expect(readingAge(t - (2 * 60 + 45) * 60_000, t)).toBe('2h 45m ago')
    expect(readingAge(t - (26 * 60 + 5) * 60_000, t)).toBe('1d 2h ago')
    expect(readingAge(0, t)).toBeUndefined()
    expect(readingAge(t, 0)).toBeUndefined()
  })

  test('ramShown', () => {
    const shown = ramShown({ totalKb: TOTAL_KB, availableKb: 2763084 })
    expect(Math.round(shown.usedPercent)).toBe(29)
    expect(shown.color).toBe('green')
  })
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`${surface}: host and RAM sit left of the usage bars, color follows free RAM`, async ($, on) => {
    const clock = mock.clock(on, { now: Date.parse('2026-10-06T23:00:00Z') })
    mock.env(on, { SSH_CONNECTION: SSH })
    let availableKb = 2763084
    on('fs.read', ($, e) => {
      if (e.path === '/etc/hostname') return { value: 'devbox\n' }
      if (e.path === '/proc/meminfo') return { value: meminfo(availableKb) }
      return { deny: `no such file in this test: ${e.path}` }
    })
    on('session.usage', () => ({
      value: {
        startedAt: 0,
        context: { window: 200_000 },
        rateLimits: [
          { kind: 'five_hour', percentUsed: 18, resetsAt: '2026-10-07T01:41:00Z' },
          { kind: 'seven_day', percentUsed: 83, resetsAt: '2026-10-13T13:00:00Z' },
        ],
      },
    }))
    on('session.start', ($, e) => ({ cwd: e.cwd }))

    await $.session.start({ cwd: '/home/user/project', surface, isInteractive: true })
    await clock.settle()
    const ui = await $.ui.mount({ plugin: 'ssh-usage-band', surface, component: 'AbovePrompt', props: PROPS })

    const texts = async () => (await ui.findAll({ type: 'Text' })).map(t => t.text)
    expect(await texts()).toEqual([
      'SSH devbox (192.0.2.10)',
      'RAM',
      '██░░░░░░',
      '29%',
      '5h',
      '█░░░░░░░',
      '18%',
      '↻ 2h 41m',
      '7d',
      '███████░',
      '83%',
      '↻ 6d',
    ])
    expect((await ui.find({ type: 'Text', text: '29%' }))?.props.color).toBe('green')
    expect((await ui.find({ type: 'Text', text: 'SSH devbox (192.0.2.10)' }))?.props.dimColor).toBe(true)
    expect((await ui.find({ type: 'Text', text: '18%' }))?.props.color).toBe('green')
    expect((await ui.find({ type: 'Text', text: '83%' }))?.props.color).toBe('#ff8700')

    availableKb = Math.round(TOTAL_KB * 0.25)
    await clock.advance(10_000)
    expect((await ui.find({ type: 'Text', text: '75%' }))?.props.color).toBe('yellow')
    expect(await ui.find({ type: 'Text', text: '██████░░' })).toBeDefined()

    availableKb = Math.round(TOTAL_KB * 0.15)
    await clock.advance(10_000)
    expect((await ui.find({ type: 'Text', text: '85%' }))?.props.color).toBe('#ff8700')
    expect((await ui.find({ type: 'Text', text: '███████░' }))?.props.color).toBe('#ff8700')

    availableKb = Math.round(TOTAL_KB * 0.04)
    await clock.advance(10_000)
    expect((await ui.find({ type: 'Text', text: '96%' }))?.props.color).toBe('red')
    expect((await ui.find({ type: 'Text', text: '████████' }))?.props.color).toBe('red')

    // The usage bars keep their own colors.
    expect((await ui.find({ type: 'Text', text: '18%' }))?.props.color).toBe('green')
    expect((await ui.find({ type: 'Text', text: '83%' }))?.props.color).toBe('#ff8700')
  })

  test(`${surface}: an idle session dims a window past its reset, ages the reading, a turn refreshes both`, async ($, on) => {
    const clock = mock.clock(on, { now: Date.parse('2026-10-06T23:00:00Z') })
    mock.env(on, { SSH_CONNECTION: SSH })
    on('fs.read', ($, e) => {
      if (e.path === '/etc/hostname') return { value: 'devbox\n' }
      if (e.path === '/proc/meminfo') return { value: meminfo(2763084) }
      return { deny: `no such file in this test: ${e.path}` }
    })
    const before = [
      { kind: 'five_hour', percentUsed: 72, resetsAt: '2026-10-06T23:20:00Z' },
      { kind: 'seven_day', percentUsed: 83, resetsAt: '2026-10-13T13:00:00Z' },
    ]
    on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000 }, rateLimits: before } }))
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('session.measure', ($, e) => ({ changed: e.changed }))

    await $.session.start({ cwd: '/home/user/project', surface, isInteractive: true })
    await clock.settle()
    const ui = await $.ui.mount({ plugin: 'ssh-usage-band', surface, component: 'AbovePrompt', props: PROPS })
    const usageTexts = async () => (await ui.findAll({ type: 'Text' })).map(t => t.text).slice(4)

    // Fresh: no age label.
    expect(await usageTexts()).toEqual(['5h', '██████░░', '72%', '↻ 20m', '7d', '███████░', '83%', '↻ 6d'])

    // Idle past the 5h reset: that window dims to "reset", the reading shows its age.
    await clock.advance(25 * 60_000)
    expect(await usageTexts()).toEqual([
      '5h',
      '░░░░░░░░',
      'reset',
      '7d',
      '███████░',
      '83%',
      '↻ 6d',
      '25m ago',
    ])
    expect((await ui.find({ type: 'Text', text: 'reset' }))?.props.dimColor).toBe(true)
    expect((await ui.find({ type: 'Text', text: '░░░░░░░░' }))?.props.dimColor).toBe(true)
    expect((await ui.find({ type: 'Text', text: '25m ago' }))?.props.dimColor).toBe(true)

    // The next turn brings a new 5h window.
    const after = [
      { kind: 'five_hour', percentUsed: 3, resetsAt: '2026-10-07T04:25:00Z' },
      { kind: 'seven_day', percentUsed: 84, resetsAt: '2026-10-13T13:00:00Z' },
    ]
    await $.session.measure({ context: { window: 200_000 }, rateLimits: after, changed: ['rateLimits'] })
    await clock.settle()
    expect(await usageTexts()).toEqual(['5h', '░░░░░░░░', '3%', '↻ 5h 0m', '7d', '███████░', '84%', '↻ 6d'])

    // A turn where only the context moved still refreshes the reading's age.
    await clock.advance(10 * 60_000)
    expect((await usageTexts()).at(-1)).toBe('10m ago')
    await $.session.measure({ context: { window: 200_000 }, rateLimits: after, changed: ['context'] })
    await clock.settle()
    expect(await ui.find({ type: 'Text', text: '10m ago' })).toBeUndefined()
  })

  test(`${surface}: host and RAM show before any usage limits arrive`, async ($, on) => {
    mock.clock(on, { now: Date.parse('2026-10-06T23:00:00Z') })
    mock.env(on, { SSH_CONNECTION: SSH })
    on('fs.read', ($, e) => {
      if (e.path === '/etc/hostname') return { value: 'devbox\n' }
      if (e.path === '/proc/meminfo') return { value: meminfo(2763084) }
      return { deny: `no such file in this test: ${e.path}` }
    })
    on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] } }))
    on('session.start', ($, e) => ({ cwd: e.cwd }))

    await $.session.start({ cwd: '/home/user/project', surface, isInteractive: true })
    const ui = await $.ui.mount({ plugin: 'ssh-usage-band', surface, component: 'AbovePrompt', props: PROPS })

    expect(await ui.find({ type: 'Text', text: 'SSH devbox (192.0.2.10)' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '29%' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '5h' })).toBeUndefined()
  })

  test(`${surface}: with no /etc/hostname or /proc/meminfo (macOS), only the usage bars show`, async ($, on) => {
    const clock = mock.clock(on, { now: Date.parse('2026-10-06T23:00:00Z') })
    mock.env(on, {})
    on('fs.read', ($, e) => ({ deny: `no such file in this test: ${e.path}` }))
    on('session.usage', () => ({
      value: {
        startedAt: 0,
        context: { window: 200_000 },
        rateLimits: [
          { kind: 'five_hour', percentUsed: 18, resetsAt: '2026-10-07T01:41:00Z' },
          { kind: 'seven_day', percentUsed: 83, resetsAt: '2026-10-13T13:00:00Z' },
        ],
      },
    }))
    on('session.start', ($, e) => ({ cwd: e.cwd }))

    await $.session.start({ cwd: '/home/user/project', surface, isInteractive: true })
    await clock.settle()
    const ui = await $.ui.mount({ plugin: 'ssh-usage-band', surface, component: 'AbovePrompt', props: PROPS })

    const usageOnly = ['5h', '█░░░░░░░', '18%', '↻ 2h 41m', '7d', '███████░', '83%', '↻ 6d']
    const texts = async () => (await ui.findAll({ type: 'Text' })).map(t => t.text)
    expect(await texts()).toEqual(usageOnly)

    // The RAM poll keeps failing quietly; the row stays the same.
    await clock.advance(30_000)
    expect(await texts()).toEqual(usageOnly)
  })
}
