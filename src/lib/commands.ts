import type { Editor } from 'tldraw'
import {
  runCleanUpLayout,
  runExplainThis,
  runSummarizeAsSticky,
  runTurnIntoFlowchart,
} from '../ai/selectionActions'
import { applyDiagramStyle } from '../ai/diagram/style'
import { useDiagramStyleStore } from '../store/diagramStyleStore'
import { useAppStore } from '../store/appStore'
import { useAiChatStore } from '../store/aiChatStore'
import { useLibraryStore } from '../store/libraryStore'
import { useUiStore } from '../store/uiStore'
import { exportBoardJson, exportBoardPng, exportBoardSvg } from './exportBoard'

export type CommandItem = {
  id: string
  label: string
  hint?: string
  keywords?: string
  group: 'DrawAI' | 'Insert' | 'View' | 'Export' | 'Edit'
  run: (editor: Editor | null) => void
}

export function getCommandItems(): CommandItem[] {
  return [
    {
      id: 'insert-preset',
      label: 'Insert preset…',
      hint: 'Open shapes panel',
      keywords: 'shapes library icons',
      group: 'Insert',
      run: () => {
        useAppStore.getState().setBoardsDrawerOpen(false)
        useLibraryStore.getState().setPanelOpen(true)
      },
    },
    {
      id: 'sticky-note',
      label: 'Sticky note',
      hint: 'N',
      keywords: 'note sticky',
      group: 'Insert',
      run: (editor) => editor?.setCurrentTool('note'),
    },
    {
      id: 'quick-text',
      label: 'Text tool',
      hint: 'T',
      keywords: 'text type',
      group: 'Insert',
      run: (editor) => editor?.setCurrentTool('text'),
    },
    {
      id: 'frame-tool',
      label: 'Frame tool',
      hint: 'F',
      keywords: 'frame',
      group: 'Insert',
      run: (editor) => editor?.setCurrentTool('frame'),
    },
    {
      id: 'run-ai',
      label: 'Generate new diagram…',
      hint: '⌘/Ctrl+Shift+I',
      keywords: 'diagram generate assistant fresh',
      group: 'DrawAI',
      run: () => {
        useAiChatStore.getState().openChat({ mode: 'generate' })
      },
    },
    {
      id: 'edit-selection-ai',
      label: 'Ask AI…',
      hint: '⌘/Ctrl+I',
      keywords: 'patch selection edit assistant chat',
      group: 'DrawAI',
      run: () => {
        useAiChatStore.getState().openChat()
      },
    },
    {
      id: 'cleanup-layout',
      label: 'Tidy up',
      keywords: 'elk layout clean up arrange align selection',
      group: 'DrawAI',
      run: (editor) => {
        if (!editor) return
        void runCleanUpLayout(editor)
      },
    },
    {
      id: 'toggle-diagram-style',
      label: 'Switch diagram style (Clean / Sketch)',
      keywords: 'sketch hand drawn clean style look',
      group: 'DrawAI',
      run: (editor) => {
        const next = useDiagramStyleStore.getState().style === 'clean' ? 'sketch' : 'clean'
        useDiagramStyleStore.getState().setStyle(next)
        if (editor) applyDiagramStyle(editor, next)
      },
    },
    {
      id: 'explain-selection',
      label: 'Explain this',
      keywords: 'describe selection ai',
      group: 'DrawAI',
      run: (editor) => {
        if (!editor) return
        void runExplainThis(editor).then((result) => {
          if (result.ok && result.text) {
            useUiStore.getState().openExplainDialog('Explain this', result.text)
          }
        })
      },
    },
    {
      id: 'turn-flowchart',
      label: 'Turn into flowchart',
      keywords: 'flowchart convert',
      group: 'DrawAI',
      run: (editor) => {
        if (!editor) return
        void runTurnIntoFlowchart(editor)
      },
    },
    {
      id: 'summarize-sticky',
      label: 'Summarize as sticky note',
      keywords: 'summary note sticky',
      group: 'DrawAI',
      run: (editor) => {
        if (!editor) return
        void runSummarizeAsSticky(editor)
      },
    },
    {
      id: 'image-to-diagram',
      label: 'Image to diagram…',
      keywords: 'vision sketch photo upload',
      group: 'DrawAI',
      run: () => useUiStore.getState().openImageDialog(),
    },
    {
      id: 'mermaid-import',
      label: 'Import Mermaid…',
      keywords: 'mermaid flowchart paste',
      group: 'DrawAI',
      run: () => useUiStore.getState().openMermaidDialog(),
    },
    {
      id: 'share-live',
      label: 'Share live session…',
      keywords: 'collaborate multiplayer share link readonly',
      group: 'DrawAI',
      run: () => useUiStore.getState().openShareDialog(),
    },
    {
      id: 'leave-live',
      label: 'Leave live room',
      keywords: 'exit collaboration',
      group: 'DrawAI',
      run: () => {
        window.location.hash = '#/'
      },
    },
    {
      id: 'export-png',
      label: 'Export PNG',
      keywords: 'download image',
      group: 'Export',
      run: (editor) => {
        if (!editor) return
        const name = useAppStore.getState().getActiveBoard()?.name ?? 'Untitled'
        void exportBoardPng(editor, name)
      },
    },
    {
      id: 'export-svg',
      label: 'Export SVG',
      group: 'Export',
      run: (editor) => {
        if (!editor) return
        const name = useAppStore.getState().getActiveBoard()?.name ?? 'Untitled'
        void exportBoardSvg(editor, name)
      },
    },
    {
      id: 'export-json',
      label: 'Export JSON',
      group: 'Export',
      run: (editor) => {
        if (!editor) return
        const name = useAppStore.getState().getActiveBoard()?.name ?? 'Untitled'
        void exportBoardJson(editor, name)
      },
    },
    {
      id: 'toggle-theme',
      label: 'Toggle theme',
      keywords: 'dark light mode',
      group: 'View',
      run: () => {
        const { theme, setTheme } = useAppStore.getState()
        void setTheme(theme === 'dark' ? 'light' : 'dark')
      },
    },
    {
      id: 'toggle-grid',
      label: 'Toggle grid',
      hint: "⌘/'",
      keywords: 'show grid lines',
      group: 'View',
      run: () => {
        void useAppStore.getState().toggleShowGrid()
      },
    },
    {
      id: 'toggle-snap-grid',
      label: 'Toggle snap to grid',
      hint: "⌘⇧'",
      keywords: 'grid snap',
      group: 'View',
      run: () => {
        void useAppStore.getState().toggleSnapToGrid()
      },
    },
    {
      id: 'cycle-grid-style',
      label: 'Cycle grid style',
      keywords: 'lines dots none',
      group: 'View',
      run: () => {
        const { gridStyle, setGridStyle } = useAppStore.getState()
        const order = ['lines', 'dots', 'none'] as const
        void setGridStyle(order[(order.indexOf(gridStyle) + 1) % order.length])
      },
    },
    {
      id: 'toggle-snap',
      label: 'Toggle always snap',
      keywords: 'snapping guides shapes',
      group: 'View',
      run: (editor) => {
        if (!editor) return
        editor.user.updateUserPreferences({ isSnapMode: !editor.user.getIsSnapMode() })
      },
    },
    {
      id: 'zoom-to-fit',
      label: 'Zoom to fit',
      hint: 'Shift+1',
      group: 'View',
      run: (editor) => {
        editor?.zoomToFit({ animation: { duration: 200 } })
      },
    },
    {
      id: 'open-shortcuts',
      label: 'Keyboard shortcuts',
      hint: '⌘⌥/',
      keywords: 'cheat sheet help',
      group: 'DrawAI',
      run: (editor) => {
        // Prefer tldraw's dialog action when available via editor UI.
        void editor
        useUiStore.getState().closeCommandPalette()
        // Dispatched by callers that have access to actions; fallback event:
        window.dispatchEvent(new CustomEvent('drawai:open-shortcuts'))
      },
    },
    {
      id: 'duplicate',
      label: 'Duplicate',
      hint: '⌘D',
      group: 'Edit',
      run: (editor) => {
        if (!editor) return
        const ids = editor.getSelectedShapeIds()
        if (ids.length === 0) return
        editor.duplicateShapes(ids)
      },
    },
    {
      id: 'group',
      label: 'Group',
      hint: '⌘G',
      group: 'Edit',
      run: (editor) => {
        if (!editor) return
        const ids = editor.getSelectedShapeIds()
        if (ids.length < 2) return
        editor.groupShapes(ids)
      },
    },
    {
      id: 'ungroup',
      label: 'Ungroup',
      hint: '⌘⇧G',
      group: 'Edit',
      run: (editor) => {
        if (!editor) return
        editor.ungroupShapes(editor.getSelectedShapeIds())
      },
    },
    {
      id: 'toggle-lock',
      label: 'Lock / unlock',
      hint: '⇧L',
      group: 'Edit',
      run: (editor) => {
        if (!editor) return
        editor.toggleLock(editor.getSelectedShapeIds())
      },
    },
    {
      id: 'align-left',
      label: 'Align left',
      group: 'Edit',
      run: (editor) => {
        if (!editor) return
        editor.alignShapes(editor.getSelectedShapeIds(), 'left')
      },
    },
    {
      id: 'align-right',
      label: 'Align right',
      group: 'Edit',
      run: (editor) => {
        if (!editor) return
        editor.alignShapes(editor.getSelectedShapeIds(), 'right')
      },
    },
    {
      id: 'align-top',
      label: 'Align top',
      group: 'Edit',
      run: (editor) => {
        if (!editor) return
        editor.alignShapes(editor.getSelectedShapeIds(), 'top')
      },
    },
    {
      id: 'align-bottom',
      label: 'Align bottom',
      group: 'Edit',
      run: (editor) => {
        if (!editor) return
        editor.alignShapes(editor.getSelectedShapeIds(), 'bottom')
      },
    },
    {
      id: 'distribute-h',
      label: 'Distribute horizontally',
      group: 'Edit',
      run: (editor) => {
        if (!editor) return
        editor.distributeShapes(editor.getSelectedShapeIds(), 'horizontal')
      },
    },
    {
      id: 'distribute-v',
      label: 'Distribute vertically',
      group: 'Edit',
      run: (editor) => {
        if (!editor) return
        editor.distributeShapes(editor.getSelectedShapeIds(), 'vertical')
      },
    },
  ]
}
