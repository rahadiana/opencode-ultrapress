/**
 * Structured logger for UltraPress.
 * Prefixes all output with [UltraPress] and supports levels.
 */

import type { NotificationLevel } from "../config/schema.js"

const PREFIX = "\x1b[35m[UltraPress]\x1b[0m"

let _level: NotificationLevel = "minimal"

export function setLogLevel(level: NotificationLevel): void {
  _level = level
}

export function getLogLevel(): NotificationLevel {
  return _level
}

/** Always shown (errors) */
export function error(msg: string, ...args: unknown[]): void {
  console.error(`${PREFIX} \x1b[31m✖\x1b[0m ${msg}`, ...args)
}

/** Shown in minimal+ mode */
export function info(msg: string, ...args: unknown[]): void {
  if (_level === "off") return
  console.log(`${PREFIX} ${msg}`, ...args)
}

/** Shown only in detailed mode */
export function debug(msg: string, ...args: unknown[]): void {
  if (_level !== "detailed") return
  console.log(`${PREFIX} \x1b[90m${msg}\x1b[0m`, ...args)
}

/** Format a compression stat line */
export function stat(label: string, value: string): void {
  if (_level === "off") return
  console.log(`${PREFIX} \x1b[36m▸\x1b[0m ${label}: ${value}`)
}
