import { fireEvent, render, screen } from '@testing-library/react'
import { type NodeProps, ReactFlowProvider } from '@xyflow/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MINDMAP_NODE_TYPES, type MindmapActions, MindmapContext } from './mindmap-node'

const MindmapNode = MINDMAP_NODE_TYPES.mindmap

/** 右向きの枝ノード（n1）を 1 つだけ描く。React Flow 本体は使わず、Provider だけ用意する。 */
function renderNode(overrides: Partial<MindmapActions> = {}) {
  const actions: MindmapActions = {
    onLabelChange: vi.fn(),
    onAddChild: vi.fn(),
    onDelete: vi.fn(),
    focusId: null,
    ...overrides,
  }
  const props = { id: 'n1', data: { label: '', depth: 1, dir: 1 } } as unknown as NodeProps
  render(
    <ReactFlowProvider>
      <MindmapContext.Provider value={actions}>
        <MindmapNode {...props} />
      </MindmapContext.Provider>
    </ReactFlowProvider>,
  )
  return { actions, input: screen.getByPlaceholderText('入力…') }
}

describe('MindmapNode（マインドマップのノード）', () => {
  // ノード単体で描くと Handle が「ノードの外にある」と警告する（描画には影響しない）。
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('Enter で自分の向きへ子を生やす', () => {
    const { actions, input } = renderNode()
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(actions.onAddChild).toHaveBeenCalledWith('n1', 'r')
  })

  it('変換中（compositionstart〜end の間）の Enter では生やさず、確定後の Enter で生やす', () => {
    const { actions, input } = renderNode()
    fireEvent.compositionStart(input)
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(actions.onAddChild).not.toHaveBeenCalled()

    fireEvent.compositionEnd(input)
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(actions.onAddChild).toHaveBeenCalledTimes(1)
  })

  it('isComposing の付いた Enter では生やさない', () => {
    const { actions, input } = renderNode()
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
    expect(actions.onAddChild).not.toHaveBeenCalled()
  })

  it('compositionend の後に届く keyCode 229 の Enter（Safari の確定）では生やさない', () => {
    const { actions, input } = renderNode()
    fireEvent.compositionStart(input)
    fireEvent.compositionEnd(input)
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 })
    expect(actions.onAddChild).not.toHaveBeenCalled()
  })

  it('focusId が自分なら入力へフォーカスする', () => {
    const { input } = renderNode({ focusId: 'n1' })
    expect(input).toHaveFocus()
  })

  it('focusId が他のノードならフォーカスしない', () => {
    const { input } = renderNode({ focusId: 'other' })
    expect(input).not.toHaveFocus()
  })
})
