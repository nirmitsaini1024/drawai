import { inlineBase64AssetStore, type TLAssetStore } from 'tldraw'

/** Fine for local/dev collab; swap for remote object storage in production. */
export const collabAssetStore: TLAssetStore = inlineBase64AssetStore
