declare namespace JSX {
  interface IntrinsicAttributes { key?: string | number }
  interface Element {}
  interface IntrinsicElements {
    [elementName: string]: Record<string, unknown>
  }
}

declare module 'react' {
  export type SVGProps<T> = Record<string, unknown>
  export type ReactNode = unknown
  export function useState<T>(initial: T): [T, (value: T | ((previous: T) => T)) => void]
  export function useState<T = undefined>(): [T | undefined, (value: T | undefined | ((previous: T | undefined) => T | undefined)) => void]
  export function useEffect(effect: () => void | (() => void), dependencies?: readonly unknown[]): void
  export function useMemo<T>(factory: () => T, dependencies: readonly unknown[]): T
  export function useCallback<T extends (...args: never[]) => unknown>(callback: T, dependencies: readonly unknown[]): T
  export function useSyncExternalStore<T>(
    subscribe: (listener: () => void) => () => void,
    getSnapshot: () => T,
    getServerSnapshot?: () => T,
  ): T
  export const StrictMode: (props: { children?: unknown }) => JSX.Element
}

declare module 'react/jsx-runtime' {
  export const jsx: (...args: unknown[]) => unknown
  export const jsxs: (...args: unknown[]) => unknown
  export const Fragment: unknown
}

declare module 'react-dom/client' {
  export function createRoot(element: Element): { render(node: unknown): void }
}

declare module 'tldraw' {
  export interface TLGlobalShapePropsMap {}
  export type TLUserPreferences = { id: string; colorScheme?: 'light' | 'dark' | 'system' }
  export function atom<T>(name: string, value: T): { get(): T; set(value: T): void }
  export type TLShapeId = string & { readonly __shape: unique symbol }
  export type TLAssetId = string & { readonly __asset: unique symbol }
  export type TLPageId = string & { readonly __page: unique symbol }
  export type TLShape<T extends string = string> = {
    id: TLShapeId
    typeName: 'shape'
    type: T
    x: number
    y: number
    rotation: number
    index: string
    parentId: string
    isLocked: boolean
    opacity: number
    props: T extends keyof TLGlobalShapePropsMap ? TLGlobalShapePropsMap[T] : Record<string, unknown>
    meta: Record<string, unknown>
  }
  export type TLPage = {
    id: TLPageId
    typeName: 'page'
    name: string
    index: string
    meta: Record<string, unknown>
  }
  export type TLAsset = {
    id: TLAssetId
    typeName: 'asset'
    type: string
    props: Record<string, unknown> & { src?: string | null }
    meta: Record<string, unknown>
  }
  export type RecordProps<T> = Record<string, unknown>
  export const T: { number: unknown; string: unknown }
  export class BaseBoxShapeUtil<S> {
    static type: string
    static props: unknown
    editor: Editor
    canEdit(shape: S): boolean
    canResize(shape: S): boolean
  }
  export function HTMLContainer(props: Record<string, unknown>): JSX.Element
  export function Tldraw(props: Record<string, unknown>): JSX.Element
  export const AssetRecordType: { createId(): TLAssetId }
  export function createShapeId(value?: string): TLShapeId
  export class Editor {
    store: {
      listen(
        callback: (entry: {
          changes: {
            added: Record<string, unknown>
            updated: Record<string, [unknown, unknown]>
            removed: Record<string, unknown>
          }
        }) => void,
        options?: Record<string, unknown>,
      ): () => void
    }
    markEventAsHandled(event: unknown): void
    getEditingShapeId(): TLShapeId | null
    getAsset(id: TLAssetId): TLAsset | undefined
    createAssets(assets: unknown[]): void
    updateAssets(assets: unknown[]): void
    deleteAssets(ids: TLAssetId[]): void
    getPages(): TLPage[]
    getCurrentPage(): TLPage
    getPage(id: TLPageId): TLPage | undefined
    getCurrentPageId(): TLPageId
    getPageShapeIds(id: TLPageId): Set<TLShapeId>
    getCurrentPageShapes(): TLShape[]
    getShape(id: TLShapeId): TLShape | undefined
    getSelectedShapes(): TLShape[]
    getViewportPageBounds(): { x: number; y: number; center: { x: number; y: number } }
    createPage(input: { name: string }): void
    renamePage(id: TLPageId, name: string): void
    updatePage(input: { id: TLPageId; meta: Record<string, unknown> }): void
    setCurrentPage(id: TLPageId): void
    createShape(input: unknown): void
    createShapes(input: unknown[]): void
    updateShape(input: unknown): void
    deleteShapes(ids: TLShapeId[]): void
    select(id: TLShapeId): void
    zoomToFit(options?: unknown): void
    zoomToSelection(options?: unknown): void
    updateInstanceState(partial: Record<string, unknown>): void
    markHistoryStoppingPoint(name?: string): string
    squashToMark(mark: string): void
    bailToMark(mark: string): void
    run<T>(callback: () => T, options?: { history?: 'record' | 'ignore' | 'record-preserveRedoStack' }): T
  }
}

declare module 'ajv/dist/2020' {
  export type ErrorObject = {
    keyword: string
    params: Record<string, unknown> & { missingProperty?: string }
    instancePath: string
    message?: string
  }
  type Validator = ((input: unknown) => boolean) & { errors?: ErrorObject[] | null }
  export default class Ajv2020 {
    constructor(options?: Record<string, unknown>)
    compile(schema: unknown): Validator
    errors?: ErrorObject[] | null
  }
}

declare module 'ajv-formats' {
  export default function addFormats(ajv: unknown): void
}

declare module '*.css' {
  const value: string
  export default value
}

declare interface ImportMetaEnv {
  readonly BASE_URL: string
  readonly VITE_TLDRAW_LICENSE_KEY?: string
}

declare interface ImportMeta {
  readonly env: ImportMetaEnv
}
