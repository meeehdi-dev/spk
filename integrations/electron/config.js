import { readFileSync, writeFileSync } from 'node:fs'

let file = ''

/** Set the config.json path (userData is only known once electron is ready). */
export const setConfigFile = path => {
  file = path
}

export const readConfig = () => {
  try {
    const config = JSON.parse(readFileSync(file, 'utf8'))
    return config && typeof config === 'object' && !Array.isArray(config) ? config : {}
  } catch {
    return {}
  }
}

export const writeConfig = patch => writeFileSync(file, JSON.stringify({ ...readConfig(), ...patch }))
