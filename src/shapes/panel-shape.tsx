import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  type Editor,
  type RecordProps,
  type TLAssetId,
  type TLShape,
  useImageOrVideoAsset,
  useValue,
} from 'tldraw'
import { useMemo, useState } from 'react'
import { dispatchPanelAction } from './panel-events'
import { parsePanelPayload } from '../workspaces/panel-data'
import type {
  ControlsPanelPayload,
  GenerationOperation,
  JsonValue,
  OutputPanelPayload,
  PanelPayload,
  PromptControl,
  ReferencesPanelPayload,
  WorkflowPanelPayload,
  WorkflowStageStatus,
} from '../workspaces/types'

export const PROMPT_CANVAS_PANEL_TYPE = 'prompt-canvas-panel'

export function nextWorkflowStageStatus(status: WorkflowStageStatus): WorkflowStageStatus {
  if (status === 'active') return 'complete'
  return 'active'
}

declare module 'tldraw' {
  export interface TLGlobalShapePropsMap {
    [PROMPT_CANVAS_PANEL_TYPE]: {
      w: number
      h: number
      workspaceId: string
      semanticId: string
      kind: string
      title: string
      payload: string
    }
  }
}

export type PromptCanvasPanelShape = TLShape<typeof PROMPT_CANVAS_PANEL_TYPE>

function valueForControl(payload: ControlsPanelPayload, control: PromptControl): JsonValue | undefined {
  const key = control.binding.mode === 'variable' ? control.binding.target : control.id
  return payload.values[key] ?? control.defaultValue
}

function ControlField(props: {
  workspaceId: string
  control: PromptControl
  payload: ControlsPanelPayload
  disabled: boolean
}) {
  const { workspaceId, control, payload, disabled } = props
  const value = valueForControl(payload, control)
  const update = (next: JsonValue) => {
    dispatchPanelAction({
      workspaceId,
      type: 'set-control-values',
      controlId: control.id,
      value: next,
    })
  }
  const options = control.options ?? []

  if (control.type === 'hidden') return null
  if (control.type === 'toggle') {
    return (
      <label className="pc-control pc-control--toggle">
        <span>{control.label}</span>
        <input
          disabled={disabled}
          type="checkbox"
          checked={Boolean(value)}
          onChange={(event) => update(event.currentTarget.checked)}
        />
      </label>
    )
  }

  if (control.type === 'range') {
    const numeric = typeof value === 'number' ? value : Number(value ?? control.min ?? 0)
    return (
      <label className="pc-control">
        <span className="pc-control__label">
          <span>{control.label}</span>
          <strong>{Number.isFinite(numeric) ? numeric : 0}</strong>
        </span>
        <input
          disabled={disabled}
          type="range"
          min={control.min}
          max={control.max}
          step={control.step}
          value={Number.isFinite(numeric) ? numeric : 0}
          onChange={(event) => update(Number(event.currentTarget.value))}
        />
      </label>
    )
  }

  if (control.type === 'color') {
    const color = typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : '#7ec8c3'
    return (
      <label className="pc-control pc-control--inline">
        <span>{control.label}</span>
        <input disabled={disabled} type="color" value={color} onChange={(event) => update(event.currentTarget.value)} />
      </label>
    )
  }

  if (control.type === 'chips' || control.type === 'multi-chips' || control.type === 'color-palette') {
    const selected = new Set(Array.isArray(value) ? value.map(String) : [String(value ?? '')])
    const multiple = control.type === 'multi-chips' || control.type === 'color-palette'
    return (
      <fieldset className="pc-control pc-control--fieldset" disabled={disabled}>
        <legend>{control.label}</legend>
        <div className="pc-chip-row">
          {options.map((option) => {
            const key = String(option.value)
            const active = selected.has(key)
            return (
              <button
                type="button"
                key={key}
                className={active ? 'pc-chip is-active' : 'pc-chip'}
                disabled={disabled || option.disabled}
                onClick={() => {
                  if (!multiple) update(option.value)
                  else {
                    const next = new Set(selected)
                    if (active) next.delete(key)
                    else next.add(key)
                    update([...next])
                  }
                }}
              >
                {option.label}
              </button>
            )
          })}
        </div>
      </fieldset>
    )
  }

  if (
    control.type === 'enum' ||
    control.type === 'combobox' ||
    control.type === 'aspect-ratio' ||
    control.type === 'composition'
  ) {
    if (control.allowCustom && control.type === 'combobox') {
      return (
        <label className="pc-control">
          <span>{control.label}</span>
          <input
            disabled={disabled}
            list={`pc-options-${control.id}`}
            value={typeof value === 'string' ? value : String(value ?? '')}
            placeholder={control.ui?.placeholder}
            onChange={(event) => update(event.currentTarget.value)}
          />
          <datalist id={`pc-options-${control.id}`}>
            {options.map((option) => (
              <option key={String(option.value)} value={String(option.value)}>
                {option.label}
              </option>
            ))}
          </datalist>
        </label>
      )
    }
    return (
      <label className="pc-control">
        <span>{control.label}</span>
        <select
          disabled={disabled}
          value={typeof value === 'string' || typeof value === 'number' ? String(value) : ''}
          onChange={(event) => update(event.currentTarget.value)}
        >
          {options.map((option) => (
            <option key={String(option.value)} value={String(option.value)} disabled={option.disabled}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    )
  }

  if (control.type === 'textarea' || control.type === 'freeform' || control.type === 'json') {
    const rendered =
      control.type === 'json' && typeof value === 'object'
        ? JSON.stringify(value, null, 2)
        : typeof value === 'string'
          ? value
          : String(value ?? '')
    return (
      <label className="pc-control">
        <span>{control.label}</span>
        <textarea
          disabled={disabled}
          rows={control.type === 'json' ? 8 : 4}
          value={rendered}
          onChange={(event) => {
            if (control.type !== 'json') update(event.currentTarget.value)
            else {
              try {
                update(JSON.parse(event.currentTarget.value) as JsonValue)
              } catch {
                // Keep incomplete JSON local to the textarea until it becomes valid.
              }
            }
          }}
        />
      </label>
    )
  }

  if (control.type === 'number') {
    return (
      <label className="pc-control">
        <span>{control.label}</span>
        <input
          disabled={disabled}
          type="number"
          min={control.min}
          max={control.max}
          step={control.step}
          value={typeof value === 'number' ? value : Number(value ?? 0)}
          onChange={(event) => update(Number(event.currentTarget.value))}
        />
      </label>
    )
  }

  return (
    <label className="pc-control">
      <span>{control.label}</span>
      <input
        disabled={disabled}
        type="text"
        value={typeof value === 'string' ? value : String(value ?? '')}
        placeholder={control.ui?.placeholder}
        onChange={(event) => update(event.currentTarget.value)}
      />
    </label>
  )
}

function usePropDraft(value: string): [string, (next: string) => void] {
  const [draft, setDraft] = useState(() => ({ source: value, value }))
  const current = draft.source === value ? draft.value : value
  return [current, (next) => setDraft({ source: value, value: next })]
}

function PromptPanel(props: {
  workspaceId: string
  payload: Extract<PanelPayload, { kind: 'prompt' }>
  editing: boolean
}) {
  const [body, setBody] = usePropDraft(props.payload.body)
  const [negative, setNegative] = usePropDraft(props.payload.negativePrompt)

  return (
    <div className="pc-panel__body pc-prompt-panel">
      <label>
        <span className="pc-section-label">Task / prompt</span>
        <textarea
          disabled={!props.editing}
          value={body}
          onChange={(event) => setBody(event.currentTarget.value)}
          onBlur={() => {
            if (body !== props.payload.body) {
              dispatchPanelAction({
                workspaceId: props.workspaceId,
                type: 'workspace-update',
                operation: { op: 'set_prompt_body', body },
              })
            }
          }}
        />
      </label>
      <label className="pc-negative-prompt">
        <span className="pc-section-label">Negative prompt</span>
        <textarea
          disabled={!props.editing}
          value={negative}
          onChange={(event) => setNegative(event.currentTarget.value)}
          onBlur={() => {
            if (negative !== props.payload.negativePrompt) {
              dispatchPanelAction({
                workspaceId: props.workspaceId,
                type: 'workspace-update',
                operation: { op: 'set_negative_prompt', body: negative },
              })
            }
          }}
        />
      </label>
    </div>
  )
}

function ControlsPanel(props: {
  workspaceId: string
  payload: ControlsPanelPayload
  editing: boolean
}) {
  return (
    <div className="pc-panel__body pc-controls-panel">
      {props.payload.controls.length === 0 ? (
        <p className="pc-empty-copy">This prompt intentionally stays freeform.</p>
      ) : (
        props.payload.controls.map((control) => (
          <ControlField
            key={control.id}
            workspaceId={props.workspaceId}
            control={control}
            payload={props.payload}
            disabled={!props.editing}
          />
        ))
      )}
    </div>
  )
}

function AssetThumb(props: {
  assetId: string
  label?: string
  selected?: boolean
  onClick?: () => void
}) {
  const { url } = useImageOrVideoAsset({
    assetId: props.assetId as TLAssetId,
    width: 360,
  })
  return (
    <button
      type="button"
      className={props.selected ? 'pc-asset-thumb is-selected' : 'pc-asset-thumb'}
      onClick={props.onClick}
      disabled={!props.onClick}
    >
      {url ? <img src={url} alt={props.label ?? 'Generated image'} draggable={false} /> : <span>Image unavailable</span>}
      {props.label ? <small>{props.label}</small> : null}
    </button>
  )
}

function ReferencesPanel(props: {
  workspaceId: string
  payload: ReferencesPanelPayload
  editing: boolean
}) {
  const fileInputId = `pc-file-${props.workspaceId}`
  return (
    <div className="pc-panel__body pc-reference-panel">
      {props.payload.items.length > 0 ? (
        <div className="pc-reference-grid">
          {props.payload.items.map((item) => (
            <div key={item.assetId} className="pc-reference-item">
              <AssetThumb assetId={item.assetId} label={item.label ?? item.purpose} />
              {props.editing ? (
                <button
                  type="button"
                  className="pc-text-button"
                  onClick={() =>
                    dispatchPanelAction({
                      workspaceId: props.workspaceId,
                      type: 'workspace-update',
                      operation: { op: 'remove_reference', referenceId: item.assetId },
                    })
                  }
                >
                  Remove
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <div className="pc-reference-empty">
          <strong>Add source material</strong>
          <p>{props.payload.slots.map((slot) => slot.label).join(', ') || 'Optional visual references'}</p>
        </div>
      )}
      {props.editing ? (
        <>
          <label htmlFor={fileInputId} className="pc-secondary-button">
            Add local reference
          </label>
          <input
            id={fileInputId}
            hidden
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0]
              const slot = props.payload.slots[0]
              if (!file || !slot) return
              const reader = new FileReader()
              reader.onload = () => {
                if (typeof reader.result !== 'string') return
                dispatchPanelAction({
                  workspaceId: props.workspaceId,
                  type: 'workspace-update',
                  operation: {
                    op: 'attach_reference',
                    slotId: slot.id,
                    asset: { kind: 'data_url', dataUrl: reader.result },
                    label: file.name,
                  },
                })
              }
              reader.readAsDataURL(file)
              event.currentTarget.value = ''
            }}
          />
        </>
      ) : null}
    </div>
  )
}

function OutputPanel(props: {
  workspaceId: string
  payload: OutputPanelPayload
  editing: boolean
}) {
  const assets = props.payload.assetIds
  const promoted = props.payload.promotedAssetId ?? assets[0]
  const isVariation = props.payload.kind === 'variations'
  const supportedOperations = props.payload.supportedOperations ?? props.payload.slot.operations
  const supportsOperation = (operation: GenerationOperation) =>
    supportedOperations ? supportedOperations.includes(operation) : true
  if (assets.length === 0) {
    return (
      <div className="pc-panel__body pc-output-empty">
        <div className="pc-output-empty__art" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <strong>{isVariation ? 'Variations will land here' : 'Ready for Codex image generation'}</strong>
        <p>Codex reads the canvas through WebMCP, generates natively, then returns the image to this slot.</p>
        {props.editing ? (
          <button
            type="button"
            className="pc-primary-button"
            onClick={() =>
              dispatchPanelAction({
                workspaceId: props.workspaceId,
                type: 'prepare-generation',
                outputSlotId: props.payload.slot.id,
                ...(isVariation && supportsOperation('variation') ? { operation: 'variation' } : {}),
              })
            }
          >
            Prepare for Codex
          </button>
        ) : null}
      </div>
    )
  }

  if (!isVariation) {
    const primaryId = promoted ?? assets[0]
    return (
      <div className="pc-panel__body pc-output-panel">
        {primaryId ? <AssetThumb assetId={primaryId} label={props.payload.labels?.[primaryId]} /> : null}
        {props.editing && (supportsOperation('edit') || supportsOperation('upscale')) ? (
          <div className="pc-output-actions">
            {supportsOperation('edit') ? (
              <button
                type="button"
                onClick={() =>
                  dispatchPanelAction({
                    workspaceId: props.workspaceId,
                    type: 'prepare-generation',
                    outputSlotId: props.payload.slot.id,
                    operation: 'edit',
                  })
                }
              >
                Edit with Codex
              </button>
            ) : null}
            {supportsOperation('upscale') ? (
              <button
                type="button"
                onClick={() =>
                  dispatchPanelAction({
                    workspaceId: props.workspaceId,
                    type: 'prepare-generation',
                    outputSlotId: props.payload.slot.id,
                    operation: 'upscale',
                  })
                }
              >
                Upscale
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div className="pc-panel__body pc-variation-panel">
      <div className="pc-variation-grid">
        {assets.map((assetId, index) => (
          <AssetThumb
            key={assetId}
            assetId={assetId}
            label={props.payload.labels?.[assetId] ?? `Variation ${index + 1}`}
            selected={assetId === promoted}
            onClick={
              props.editing
                ? () =>
                    dispatchPanelAction({
                      workspaceId: props.workspaceId,
                      type: 'manage-output',
                      operation: { op: 'promote', assetId },
                    })
                : undefined
            }
          />
        ))}
      </div>
    </div>
  )
}

function WorkflowPanel(props: {
  workspaceId: string
  payload: WorkflowPanelPayload
  editing: boolean
}) {
  return (
    <div className="pc-panel__body pc-workflow-panel">
      {props.payload.workflow.stages.map((stage, index) => {
        const status = props.payload.statuses[stage.id] ?? 'not-started'
        return (
          <button
            key={stage.id}
            type="button"
            className={`pc-workflow-step is-${status}`}
            disabled={!props.editing}
            onClick={() =>
              dispatchPanelAction({
                workspaceId: props.workspaceId,
                type: 'workspace-update',
                operation: {
                  op: 'set_workflow_stage',
                  stageId: stage.id,
                  status: nextWorkflowStageStatus(status),
                },
              })
            }
          >
            <span>{index + 1}</span>
            <strong>{stage.title}</strong>
            <small>{status.replace('-', ' ')}</small>
          </button>
        )
      })}
    </div>
  )
}

function PanelBody(props: {
  workspaceId: string
  payload: PanelPayload
  editing: boolean
}) {
  switch (props.payload.kind) {
    case 'prompt':
      return <PromptPanel workspaceId={props.workspaceId} payload={props.payload} editing={props.editing} />
    case 'controls':
      return <ControlsPanel workspaceId={props.workspaceId} payload={props.payload} editing={props.editing} />
    case 'references':
      return <ReferencesPanel workspaceId={props.workspaceId} payload={props.payload} editing={props.editing} />
    case 'output':
    case 'variations':
      return <OutputPanel workspaceId={props.workspaceId} payload={props.payload} editing={props.editing} />
    case 'workflow':
      return <WorkflowPanel workspaceId={props.workspaceId} payload={props.payload} editing={props.editing} />
    case 'json':
      return <pre className="pc-panel__body pc-json-panel">{JSON.stringify(props.payload.value, null, 2)}</pre>
    case 'note':
      return <div className={`pc-panel__body pc-note-panel is-${props.payload.tone ?? 'yellow'}`}>{props.payload.text}</div>
  }
}

function PromptCanvasPanel(props: { shape: PromptCanvasPanelShape; editor: Editor }) {
  const { shape, editor } = props
  const editingShapeId = useValue(
    'prompt canvas editing shape',
    () => editor.getEditingShapeId(),
    [editor],
  )
  const editing = editingShapeId === shape.id
  const parsed = useMemo(() => {
    try {
      return { payload: parsePanelPayload(shape.props.payload) }
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Invalid panel data.' }
    }
  }, [shape.props.payload])

  return (
    <HTMLContainer
      id={shape.id}
      className={`pc-panel pc-panel--${shape.props.kind} ${editing ? 'is-editing' : ''}`}
      onPointerDown={editing ? editor.markEventAsHandled : undefined}
      style={{ pointerEvents: editing ? 'all' : 'none' }}
    >
      <header className="pc-panel__header">
        <span>{shape.props.title}</span>
        <small>{editing ? 'Editing' : 'Double-click to edit'}</small>
      </header>
      {parsed.payload ? (
        <PanelBody
          workspaceId={shape.props.workspaceId}
          payload={parsed.payload}
          editing={editing}
        />
      ) : (
        <div className="pc-panel__error">{parsed.error}</div>
      )}
    </HTMLContainer>
  )
}

export class PromptCanvasPanelShapeUtil extends BaseBoxShapeUtil<PromptCanvasPanelShape> {
  static override type = PROMPT_CANVAS_PANEL_TYPE
  static override props: RecordProps<PromptCanvasPanelShape> = {
    w: T.number,
    h: T.number,
    workspaceId: T.string,
    semanticId: T.string,
    kind: T.string,
    title: T.string,
    payload: T.string,
  }

  override canEdit(): boolean {
    return true
  }

  override canResize(): boolean {
    return true
  }

  getDefaultProps(): PromptCanvasPanelShape['props'] {
    return {
      w: 420,
      h: 320,
      workspaceId: '',
      semanticId: '',
      kind: 'note',
      title: 'Prompt Canvas panel',
      payload: JSON.stringify({ kind: 'note', text: '' }),
    }
  }

  component(shape: PromptCanvasPanelShape) {
    return <PromptCanvasPanel shape={shape} editor={this.editor} />
  }

  getIndicatorPath(shape: PromptCanvasPanelShape) {
    const path = new Path2D()
    path.roundRect(0, 0, shape.props.w, shape.props.h, 14)
    return path
  }
}
