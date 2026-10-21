import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Limit, Ram } from '../types'

const limits = atom({ plugin: 'ssh-usage-band', key: 'limits' } as const, [])
const now = atom({ plugin: 'ssh-usage-band', key: 'now' } as const, 0)
const host = atom({ plugin: 'ssh-usage-band', key: 'host' } as const, '')
const dir = atom({ plugin: 'ssh-usage-band', key: 'dir' } as const, '')
const ram = atom({ plugin: 'ssh-usage-band', key: 'ram' } as const, null)
// When the session last got a usage reading: each turn's measurement carries the
// figures from that turn's last API response, so this is the session's last turn.
const readAt = atom({ plugin: 'ssh-usage-band', key: 'readAt' } as const, 0)

const LABELS: Record<string, string> = {
  five_hour: '5h',
  seven_day: '7d',
  spend_limit: 'spend',
}

const BAR_WIDTH = 8
const ORANGE = '#ff8700'

export function bar(percent: number): string {
  const filled = Math.round((Math.min(100, Math.max(0, percent)) / 100) * BAR_WIDTH)
  return '█'.repeat(filled) + '░'.repeat(BAR_WIDTH - filled)
}

export function colorFor(percent: number): string {
  if (percent >= 90) return 'red'
  if (percent >= 80) return ORANGE
  if (percent >= 70) return 'yellow'
  return 'green'
}

function span(minutes: number): string {
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  const mins = minutes % 60

  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${mins}m`
  return `${mins}m`
}

// A window whose reset time has passed: the session's reading of it predates the
// reset, so its percentage is no longer true until the session's next turn.
export function hasReset(resetsAt: string | undefined, nowMs: number): boolean {
  if (!resetsAt || nowMs <= 0) return false
  return Date.parse(resetsAt) <= nowMs
}

// A day or more out, whole days are enough and keep the row on one line.
export function untilReset(resetsAt: string | undefined, nowMs: number): string | undefined {
  if (!resetsAt) return undefined
  const ms = Date.parse(resetsAt) - nowMs
  if (Number.isNaN(ms) || ms <= 0) return undefined
  const minutes = Math.ceil(ms / 60_000)
  return minutes >= 1440 ? `↻ ${Math.floor(minutes / 1440)}d` : `↻ ${span(minutes)}`
}

// Readings younger than this are the session you're working in; no label.
const AGE_SHOWN_FROM_MS = 5 * 60_000

export function readingAge(readAtMs: number, nowMs: number): string | undefined {
  if (readAtMs <= 0 || nowMs <= 0) return undefined
  const ms = nowMs - readAtMs
  if (ms < AGE_SHOWN_FROM_MS) return undefined
  return `${span(Math.floor(ms / 60_000))} ago`
}

const RAM_POLL_MS = 10_000

// Percent of MemTotal that MemAvailable is under. Under 30 % free is over 70 % used,
// 20 % free is 80 % used, 10 % free is 90 % used: the same yellow, orange and red
// steps as colorFor, so the RAM bar changes color where the usage bars do.
const RAM_YELLOW_BELOW = 30
const RAM_ORANGE_BELOW = 20
const RAM_RED_BELOW = 10

export function hostLabel(hostname: string, sshConnection: string | undefined): string {
  // SSH_CONNECTION is "client_ip client_port server_ip server_port".
  const serverIp = sshConnection?.trim().split(/\s+/)[2]
  if (!serverIp) return hostname
  return hostname ? `SSH ${hostname} (${serverIp})` : `SSH ${serverIp}`
}

// The home directory shortens to ~, the way a shell prompt shows it.
export function dirLabel(path: string, home: string | undefined): string {
  const h = home?.replace(/\/+$/, '')
  if (!h || !path) return path
  if (path === h) return '~'
  return path.startsWith(`${h}/`) ? `~${path.slice(h.length)}` : path
}

export function parseMeminfo(text: string): Ram | null {
  const kb = (field: string) => Number(new RegExp(`^${field}:\\s+(\\d+) kB$`, 'm').exec(text)?.[1])
  const totalKb = kb('MemTotal')
  const availableKb = kb('MemAvailable')
  if (!(totalKb > 0) || Number.isNaN(availableKb)) return null
  return { totalKb, availableKb }
}

export function ramColorFor(availablePercent: number): string {
  if (availablePercent < RAM_RED_BELOW) return 'red'
  if (availablePercent < RAM_ORANGE_BELOW) return ORANGE
  if (availablePercent < RAM_YELLOW_BELOW) return 'yellow'
  return 'green'
}

// The bar fills with RAM in use, like the usage bars; the color follows what's free.
export function ramShown(r: Ram): { usedPercent: number; color: string } {
  const availablePercent = (r.availableKb / r.totalKb) * 100
  return {
    usedPercent: 100 - availablePercent,
    color: ramColorFor(availablePercent),
  }
}

export const register: Register = on => {
  let home: string | undefined

  on('session.start', async ($, e, next) => {
    const hostname = await $.fs.read('/etc/hostname').then(
      text => text.trim(),
      () => '',
    )
    const ssh = await $.env.get('SSH_CONNECTION')
    await update($, host, () => hostLabel(hostname, ssh))

    home = await $.env.get('HOME')
    const root = await $.session.root()
    await update($, dir, () => dirLabel(root, home))

    // Write only when what the band draws changes, so polling doesn't redraw it.
    let drawn = ''
    const sampleRam = async () => {
      let sample: Ram | null = null
      try {
        sample = parseMeminfo(await $.fs.read('/proc/meminfo'))
      } catch {
        sample = null
      }
      const shown = sample ? ramShown(sample) : null
      const key = shown ? `${Math.round(shown.usedPercent)} ${shown.color}` : ''
      if (key === drawn) return
      drawn = key
      await update($, ram, () => sample)
    }
    void sampleRam()
    $.clock.every(RAM_POLL_MS, () => void sampleRam())

    const usage = await $.session.usage()
    await update($, limits, () => usage.rateLimits as Limit[])
    await update($, now, () => 0)
    if (usage.rateLimits.length > 0) {
      const t = await $.clock.now()
      await update($, readAt, () => t)
    }

    const tick = async () => {
      const t = await $.clock.now()
      await update($, now, () => t)
    }
    void tick()
    $.clock.every(60_000, () => void tick())

    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    // /cd moves the session's project directory without an event of its own;
    // each turn's measurement picks it up, and the band redraws only on a change.
    const label = dirLabel(await $.session.root(), home)
    if (label !== (await read($, dir))) await update($, dir, () => label)

    // Every measurement carries the current figures, even when only the context
    // moved, so it refreshes the reading's age; the bars redraw only on a change.
    if (e.rateLimits.length > 0) {
      const t = await $.clock.now()
      if (e.changed.includes('rateLimits')) await update($, limits, () => e.rateLimits as Limit[])
      await update($, readAt, () => t)
      await update($, now, () => t)
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const current = await read($, limits)
    const hostText = await read($, host)
    const dirText = await read($, dir)
    const mem = await read($, ram)
    if (e.props.hasSurvey || (current.length === 0 && !hostText && !dirText && !mem)) {
      return next(e)
    }

    const nowMs = await read($, now)
    const age = current.length > 0 ? readingAge(await read($, readAt), nowMs) : undefined
    const { Box, Text } = $.ui.resolve(e)
    const shown = mem ? ramShown(mem) : null

    return (
      <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
        {hostText ? <Text dimColor>{hostText}</Text> : null}
        {dirText ? <Text dimColor>{dirText}</Text> : null}
        {shown ? (
          <Box key="ram" flexDirection="row" gap={1}>
            <Text dimColor>RAM</Text>
            <Text color={shown.color}>{bar(shown.usedPercent)}</Text>
            <Text bold color={shown.color}>
              {`${Math.round(shown.usedPercent)}%`}
            </Text>
          </Box>
        ) : null}
        {current.map(limit => {
          const label = LABELS[limit.kind] ?? limit.kind
          if (hasReset(limit.resetsAt, nowMs)) {
            return (
              <Box key={limit.kind} flexDirection="row" gap={1}>
                <Text dimColor>{label}</Text>
                <Text dimColor>{bar(0)}</Text>
                <Text dimColor>reset</Text>
              </Box>
            )
          }
          const reset = nowMs > 0 ? untilReset(limit.resetsAt, nowMs) : undefined
          return (
            <Box key={limit.kind} flexDirection="row" gap={1}>
              <Text dimColor>{label}</Text>
              <Text color={colorFor(limit.percentUsed)}>{bar(limit.percentUsed)}</Text>
              <Text bold color={colorFor(limit.percentUsed)}>
                {`${Math.round(limit.percentUsed)}%`}
              </Text>
              {reset ? <Text dimColor>{reset}</Text> : null}
            </Box>
          )
        })}
        {age ? <Text dimColor>{age}</Text> : null}
      </Box>
    )
  })
}
