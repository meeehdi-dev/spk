import type { Component } from 'vue'

import { UApp } from '#components'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { createError } from 'h3'
import { defineComponent, h } from 'vue'

type MountOptions = NonNullable<Parameters<typeof mountSuspended>[1]>

/** A failed endpoint response that `$fetch` does not retry, so one mocked failure is one failed request. */
export const requestError = (message: string) => createError({ statusCode: 400, message })

/** Mounts inside UApp so Nuxt UI tooltips, toasts and overlays find their providers. Pass `reactive()` props to change them later. */
export const mountInApp = (component: Component, props: Record<string, unknown> = {}, options: MountOptions = {}) =>
  mountSuspended(defineComponent({ setup: () => () => h(UApp, null, { default: () => h(component, { ...props }) }) }), options)
