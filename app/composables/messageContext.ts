import type { InjectionKey } from 'vue'

export interface MessageCtx {
  id: string, channelId: string, userId: string, body: string, own: boolean
  /** Put `> text` into the input. */
  quote: (text: string) => void
  /** Own messages only: saves a new language for the Nth fenced block with this code as an edit. False if it can't be located. */
  setLanguage: (occurrence: number, lang: string, code: string) => Promise<boolean>
}
export const messageCtxKey: InjectionKey<MessageCtx> = Symbol('messageCtx')

/** What a message can do; provided by the channel view so rows stay presentational. */
export interface ChatActions {
  /** Saves new Markdown as an edit; false if the server refused. */
  edit: (id: string, body: string) => Promise<boolean>
  remove: (id: string) => Promise<void>
  react: (id: string, emoji: string, on: boolean) => Promise<void>
  reply: (id: string) => void
  /** Scroll to a message, loading its surroundings if needed. */
  jump: (id: string) => void
  removePreview: (id: string, url: string) => Promise<void>
  openImage: (file: import('../../server/db/messages').AttachmentDto) => void
}
export const chatActionsKey: InjectionKey<ChatActions> = Symbol('chatActions')
