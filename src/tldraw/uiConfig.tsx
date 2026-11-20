import {
  DefaultContextMenu,
  DefaultContextMenuContent,
  DefaultKeyboardShortcutsDialog,
  DefaultKeyboardShortcutsDialogContent,
  TldrawUiMenuActionItem,
  TldrawUiMenuGroup,
  useActions,
  type TLComponents,
  type TLUiContextMenuProps,
  type TLUiKeyboardShortcutsDialogProps,
  type TLUiOverrides,
} from 'tldraw'
import { useEffect } from 'react'
import {
  runCleanUpLayout,
  runExplainThis,
  runSummarizeAsSticky,
  runTurnIntoFlowchart,
} from '../ai/selectionActions'
import { AiChatLauncher, AiChatPopover } from '../components/AiChatPopover'
import { CanvasGrid } from '../components/CanvasGrid'
import { SaveAsShapeButton } from '../components/SaveAsShapeButton'
import { exportBoardPng } from '../lib/exportBoard'
import { applyDiagramStyle } from '../ai/diagram/style'
import { useAiChatStore } from '../store/aiChatStore'
import { useDiagramStyleStore } from '../store/diagramStyleStore'
import { useAppStore } from '../store/appStore'
import { useLibraryStore } from '../store/libraryStore'
import { useUiStore } from '../store/uiStore'

export const SAVE_AS_SHAPE_ACTION = 'save-as-shape'
export const COMMAND_PALETTE_ACTION = 'command-palette'
export const OPEN_SHAPES_ACTION = 'open-shapes-panel'
export const RUN_AI_ACTION = 'run-ai'
export const EDIT_SELECTION_AI_ACTION = 'edit-selection-ai'
export const CLEANUP_LAYOUT_ACTION = 'ai-cleanup-layout'
export const TOGGLE_DIAGRAM_STYLE_ACTION = 'toggle-diagram-style'
export const EXPLAIN_SELECTION_ACTION = 'ai-explain-selection'
export const TURN_FLOWCHART_ACTION = 'ai-turn-flowchart'
export const SUMMARIZE_STICKY_ACTION = 'ai-summarize-sticky'
export const IMAGE_TO_DIAGRAM_ACTION = 'image-to-diagram'
export const MERMAID_IMPORT_ACTION = 'mermaid-import'
export const SHARE_LIVE_ACTION = 'share-live'
export const TOGGLE_THEME_ACTION = 'toggle-drawai-theme'
export const EXPORT_PNG_ACTION = 'export-png-drawai'
export const TOGGLE_SHOW_GRID_ACTION = 'toggle-drawai-grid'
export const TOGGLE_SNAP_GRID_ACTION = 'toggle-drawai-snap-grid'
export const CYCLE_GRID_STYLE_ACTION = 'cycle-drawai-grid-style'

/**
 * tldraw 5.6 kbd `$` syntax (see useKeyboardShortcuts getHotkeysStringFromKbd):
 *   $ = Cmd on Mac / Ctrl on Windows (accel)
 *   ! = Shift
 *   ? = Alt
 * Shortcuts are skipped while focus is in inputs/textarea/contenteditable.
 */
export const uiOverrides: TLUiOverrides = {
  actions(editor, actions, helpers) {
    const toastError = (title: string, error: string) => {
      helpers.addToast({ title, description: error })
    }

    actions[COMMAND_PALETTE_ACTION] = {
      id: COMMAND_PALETTE_ACTION,
      label: 'Command palette',
      kbd: '$k',
      readonlyOk: true,
      onSelect() {
        useUiStore.getState().toggleCommandPalette()
      },
    }

    actions[SAVE_AS_SHAPE_ACTION] = {
      id: SAVE_AS_SHAPE_ACTION,
      label: 'Save as shape',
      kbd: '$!u',
      readonlyOk: false,
      isAvailable: (ed) => ed.getSelectedShapeIds().length > 0,
      isEnabled: (ed) => ed.getSelectedShapeIds().length > 0,
      onSelect() {
        useLibraryStore.getState().openSaveDialog()
      },
    }

    actions[OPEN_SHAPES_ACTION] = {
      id: OPEN_SHAPES_ACTION,
      label: 'Open shapes panel',
      kbd: '$!p',
      readonlyOk: true,
      onSelect() {
        useAppStore.getState().setBoardsDrawerOpen(false)
        useLibraryStore.getState().setPanelOpen(true)
      },
    }

    actions[RUN_AI_ACTION] = {
      id: RUN_AI_ACTION,
      label: 'Generate new diagram',
      kbd: '$!i',
      readonlyOk: true,
      onSelect() {
        const result = useAiChatStore.getState().openChat({ mode: 'generate' })
        if (!result.ok) {
          helpers.addToast({
            title: 'Canvas not ready',
            description: 'Wait for the board to load, then try again.',
          })
        }
      },
    }

    actions[EDIT_SELECTION_AI_ACTION] = {
      id: EDIT_SELECTION_AI_ACTION,
      label: 'Ask AI',
      kbd: '$i',
      readonlyOk: false,
      onSelect() {
        // With selection → edit chat under selection; otherwise → generate popover
        const result = useAiChatStore.getState().openChat()
        if (!result.ok) {
          helpers.addToast({
            title: 'Canvas not ready',
            description: 'Wait for the board to load, then try again.',
          })
        }
      },
    }

    actions[CLEANUP_LAYOUT_ACTION] = {
      id: CLEANUP_LAYOUT_ACTION,
      label: 'Tidy up',
      readonlyOk: false,
      onSelect() {
        void runCleanUpLayout(editor).then((result) => {
          if (!result.ok) toastError('Tidy up', result.error)
          else helpers.addToast({ title: 'Diagram tidied up' })
        })
      },
    }

    actions[TOGGLE_DIAGRAM_STYLE_ACTION] = {
      id: TOGGLE_DIAGRAM_STYLE_ACTION,
      label: 'Switch diagram style (Clean / Sketch)',
      readonlyOk: false,
      onSelect() {
        const next = useDiagramStyleStore.getState().style === 'clean' ? 'sketch' : 'clean'
        useDiagramStyleStore.getState().setStyle(next)
        const changed = applyDiagramStyle(editor, next)
        helpers.addToast({
          title: `${next === 'sketch' ? 'Sketch' : 'Clean'} style`,
          description: changed > 0 ? `${changed} shapes restyled` : 'Applies to new diagrams',
        })
      },
    }

    actions[EXPLAIN_SELECTION_ACTION] = {
      id: EXPLAIN_SELECTION_ACTION,
      label: 'Explain this',
      readonlyOk: true,
      onSelect() {
        helpers.addToast({ title: 'Explaining…', description: 'Asking the model about the selection.' })
        void runExplainThis(editor).then((result) => {
          if (!result.ok) {
            toastError('Explain this', result.error)
            return
          }
          useUiStore.getState().openExplainDialog('Explain this', result.text ?? '')
        })
      },
    }

    actions[TURN_FLOWCHART_ACTION] = {
      id: TURN_FLOWCHART_ACTION,
      label: 'Turn into flowchart',
      readonlyOk: false,
      onSelect() {
        helpers.addToast({ title: 'Converting…', description: 'Rewriting selection as a flowchart.' })
        void runTurnIntoFlowchart(editor).then((result) => {
          if (!result.ok) toastError('Turn into flowchart', result.error)
          else helpers.addToast({ title: result.message ?? 'Done' })
        })
      },
    }

    actions[SUMMARIZE_STICKY_ACTION] = {
      id: SUMMARIZE_STICKY_ACTION,
      label: 'Summarize as sticky note',
      readonlyOk: false,
      onSelect() {
        helpers.addToast({ title: 'Summarizing…' })
        void runSummarizeAsSticky(editor).then((result) => {
          if (!result.ok) toastError('Summarize', result.error)
          else helpers.addToast({ title: result.message ?? 'Sticky added' })
        })
      },
    }

    actions[IMAGE_TO_DIAGRAM_ACTION] = {
      id: IMAGE_TO_DIAGRAM_ACTION,
      label: 'Image to diagram',
      readonlyOk: false,
      onSelect() {
        useUiStore.getState().openImageDialog()
      },
    }

    actions[MERMAID_IMPORT_ACTION] = {
      id: MERMAID_IMPORT_ACTION,
      label: 'Import Mermaid',
      readonlyOk: false,
      onSelect() {
        useUiStore.getState().openMermaidDialog()
      },
    }

    actions[SHARE_LIVE_ACTION] = {
      id: SHARE_LIVE_ACTION,
      label: 'Share live session',
      readonlyOk: true,
      onSelect() {
        useUiStore.getState().openShareDialog()
      },
    }

    actions[TOGGLE_THEME_ACTION] = {
      id: TOGGLE_THEME_ACTION,
      label: 'Toggle DrawAI theme',
      kbd: '$!d',
      readonlyOk: true,
      onSelect() {
        const { theme, setTheme } = useAppStore.getState()
        void setTheme(theme === 'dark' ? 'light' : 'dark')
      },
    }

    actions[EXPORT_PNG_ACTION] = {
      id: EXPORT_PNG_ACTION,
      label: 'Export PNG',
      kbd: '$!e',
      readonlyOk: true,
      onSelect() {
        const name = useAppStore.getState().getActiveBoard()?.name ?? 'Untitled'
        void exportBoardPng(editor, name)
      },
    }

    actions[TOGGLE_SHOW_GRID_ACTION] = {
      id: TOGGLE_SHOW_GRID_ACTION,
      label: 'Toggle grid',
      // Shortcut lives on tldraw's `toggle-grid` (cmd/ctrl+'); we override that action below.
      readonlyOk: true,
      checkbox: true,
      isChecked: () => useAppStore.getState().showGrid,
      onSelect() {
        void useAppStore.getState().toggleShowGrid()
      },
    }

    actions[TOGGLE_SNAP_GRID_ACTION] = {
      id: TOGGLE_SNAP_GRID_ACTION,
      label: 'Snap to grid',
      kbd: "$!'",
      readonlyOk: true,
      checkbox: true,
      isChecked: () => useAppStore.getState().snapToGrid,
      onSelect() {
        void useAppStore.getState().toggleSnapToGrid()
      },
    }

    actions[CYCLE_GRID_STYLE_ACTION] = {
      id: CYCLE_GRID_STYLE_ACTION,
      label: 'Cycle grid style',
      readonlyOk: true,
      onSelect() {
        const { gridStyle, setGridStyle } = useAppStore.getState()
        const order = ['lines', 'dots', 'none'] as const
        const next = order[(order.indexOf(gridStyle) + 1) % order.length]
        void setGridStyle(next)
      },
    }

    // Route tldraw's built-in grid toggle through DrawAI prefs (same shortcut family).
    if (actions['toggle-grid']) {
      actions['toggle-grid'] = {
        ...actions['toggle-grid'],
        isChecked: () => useAppStore.getState().showGrid,
        onSelect() {
          void useAppStore.getState().toggleShowGrid()
        },
      }
    }

    if (actions['toggle-snap-mode']) {
      actions['toggle-snap-mode'] = {
        ...actions['toggle-snap-mode'],
        kbd: '$!m',
      }
    }

    if (actions['open-kbd-shortcuts']) {
      actions['open-kbd-shortcuts'] = {
        ...actions['open-kbd-shortcuts'],
        kbd: '$?/',
      }
    }

    if (actions['toggle-dark-mode']) {
      actions['toggle-dark-mode'] = {
        ...actions['toggle-dark-mode'],
        kbd: '$/',
        onSelect() {
          const { theme, setTheme } = useAppStore.getState()
          void setTheme(theme === 'dark' ? 'light' : 'dark')
        },
      }
    }

    return actions
  },
  translations: {
    en: {
      [COMMAND_PALETTE_ACTION]: 'Command palette',
      'action.command-palette': 'Command palette',
      [SAVE_AS_SHAPE_ACTION]: 'Save as shape',
      'action.save-as-shape': 'Save as shape',
      [OPEN_SHAPES_ACTION]: 'Open shapes panel',
      'action.open-shapes-panel': 'Open shapes panel',
      [RUN_AI_ACTION]: 'Generate new diagram',
      'action.run-ai': 'Generate new diagram',
      [EDIT_SELECTION_AI_ACTION]: 'Ask AI',
      'action.edit-selection-ai': 'Ask AI',
      [CLEANUP_LAYOUT_ACTION]: 'Tidy up',
      'action.ai-cleanup-layout': 'Tidy up',
      [TOGGLE_DIAGRAM_STYLE_ACTION]: 'Switch diagram style (Clean / Sketch)',
      'action.toggle-diagram-style': 'Switch diagram style (Clean / Sketch)',
      [EXPLAIN_SELECTION_ACTION]: 'Explain this',
      'action.ai-explain-selection': 'Explain this',
      [TURN_FLOWCHART_ACTION]: 'Turn into flowchart',
      'action.ai-turn-flowchart': 'Turn into flowchart',
      [SUMMARIZE_STICKY_ACTION]: 'Summarize as sticky note',
      'action.ai-summarize-sticky': 'Summarize as sticky note',
      [IMAGE_TO_DIAGRAM_ACTION]: 'Image to diagram',
      'action.image-to-diagram': 'Image to diagram',
      [MERMAID_IMPORT_ACTION]: 'Import Mermaid',
      'action.mermaid-import': 'Import Mermaid',
      [SHARE_LIVE_ACTION]: 'Share live session',
      'action.share-live': 'Share live session',
      [TOGGLE_THEME_ACTION]: 'Toggle DrawAI theme',
      'action.toggle-drawai-theme': 'Toggle DrawAI theme',
      [EXPORT_PNG_ACTION]: 'Export PNG',
      'action.export-png-drawai': 'Export PNG',
      [TOGGLE_SHOW_GRID_ACTION]: 'Toggle grid',
      'action.toggle-drawai-grid': 'Toggle grid',
      [TOGGLE_SNAP_GRID_ACTION]: 'Snap to grid',
      'action.toggle-drawai-snap-grid': 'Snap to grid',
      [CYCLE_GRID_STYLE_ACTION]: 'Cycle grid style',
      'action.cycle-drawai-grid-style': 'Cycle grid style',
      'shortcuts-dialog.drawai': 'DrawAI',
    },
  },
}

function CustomContextMenu(props: TLUiContextMenuProps) {
  return (
    <DefaultContextMenu {...props}>
      <TldrawUiMenuGroup id="drawai-library">
        <TldrawUiMenuActionItem actionId={SAVE_AS_SHAPE_ACTION} whenDisabled="hide" />
        <TldrawUiMenuActionItem actionId={EDIT_SELECTION_AI_ACTION} />
        <TldrawUiMenuActionItem actionId={CLEANUP_LAYOUT_ACTION} />
        <TldrawUiMenuActionItem actionId={TOGGLE_DIAGRAM_STYLE_ACTION} />
        <TldrawUiMenuActionItem actionId={EXPLAIN_SELECTION_ACTION} />
        <TldrawUiMenuActionItem actionId={TURN_FLOWCHART_ACTION} />
        <TldrawUiMenuActionItem actionId={SUMMARIZE_STICKY_ACTION} />
        <TldrawUiMenuActionItem actionId={IMAGE_TO_DIAGRAM_ACTION} />
        <TldrawUiMenuActionItem actionId={MERMAID_IMPORT_ACTION} />
        <TldrawUiMenuActionItem actionId={SHARE_LIVE_ACTION} />
        <TldrawUiMenuActionItem actionId={RUN_AI_ACTION} />
        <TldrawUiMenuActionItem actionId={COMMAND_PALETTE_ACTION} />
      </TldrawUiMenuGroup>
      <DefaultContextMenuContent />
    </DefaultContextMenu>
  )
}

function CustomKeyboardShortcutsDialog(props: TLUiKeyboardShortcutsDialogProps) {
  return (
    <DefaultKeyboardShortcutsDialog {...props}>
      <TldrawUiMenuGroup id="drawai" label="shortcuts-dialog.drawai">
        <TldrawUiMenuActionItem actionId={COMMAND_PALETTE_ACTION} />
        <TldrawUiMenuActionItem actionId={OPEN_SHAPES_ACTION} />
        <TldrawUiMenuActionItem actionId={SAVE_AS_SHAPE_ACTION} />
        <TldrawUiMenuActionItem actionId={RUN_AI_ACTION} />
        <TldrawUiMenuActionItem actionId={EDIT_SELECTION_AI_ACTION} />
        <TldrawUiMenuActionItem actionId={IMAGE_TO_DIAGRAM_ACTION} />
        <TldrawUiMenuActionItem actionId={MERMAID_IMPORT_ACTION} />
        <TldrawUiMenuActionItem actionId={TOGGLE_THEME_ACTION} />
        <TldrawUiMenuActionItem actionId={EXPORT_PNG_ACTION} />
        <TldrawUiMenuActionItem actionId={TOGGLE_SHOW_GRID_ACTION} />
        <TldrawUiMenuActionItem actionId={TOGGLE_SNAP_GRID_ACTION} />
        <TldrawUiMenuActionItem actionId={CYCLE_GRID_STYLE_ACTION} />
        <TldrawUiMenuActionItem actionId="toggle-snap-mode" />
        <TldrawUiMenuActionItem actionId="open-kbd-shortcuts" />
      </TldrawUiMenuGroup>
      <DefaultKeyboardShortcutsDialogContent />
    </DefaultKeyboardShortcutsDialog>
  )
}

function ShortcutsBridge() {
  const actions = useActions()
  useEffect(() => {
    const onOpen = () => {
      actions['open-kbd-shortcuts']?.onSelect('menu')
    }
    window.addEventListener('drawai:open-shortcuts', onOpen)
    return () => window.removeEventListener('drawai:open-shortcuts', onOpen)
  }, [actions])
  return null
}

function InFrontOverlay() {
  return (
    <>
      <SaveAsShapeButton />
      <AiChatPopover />
      <AiChatLauncher />
      <ShortcutsBridge />
    </>
  )
}

export const uiComponents: TLComponents = {
  ContextMenu: CustomContextMenu,
  KeyboardShortcutsDialog: CustomKeyboardShortcutsDialog,
  InFrontOfTheCanvas: InFrontOverlay,
  Grid: CanvasGrid,
}
