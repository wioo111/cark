import { useEffect } from 'react'

import type { AnnotationComposerDraft } from '@/components/CommentLane'
import type { PaperAnnotation, PaperDetail, PaperView } from '@/types'
import { resolveAnnotationHighlight } from '@/utils/annotationLocator'
import { activateLocatedNode, clearLocatorHighlights, locateBlockNode } from '@/utils/blockLocator'

interface UseReaderLocatorEffectsArgs {
  articleRef: React.RefObject<HTMLDivElement | null>
  articleShellRef: React.RefObject<HTMLDivElement | null>
  outline: Array<{ id: string; level: number; text: string }>
  markdown: string
  annotations: PaperAnnotation[]
  positionedAnnotations: PaperAnnotation[]
  activeView: PaperView
  detail: PaperDetail | null
  draft: AnnotationComposerDraft | null
  focusedAnnotationId: string | null
  requestedBlockId: string | null
  requestedAnnotationId: string | null
  requestedBodyQuote: string | null
  requestedBodyContextBefore: string | null
  requestedBodyContextAfter: string | null
  searchHighlightTop: number | null
  onActiveSectionIdChange: React.Dispatch<React.SetStateAction<string | null>>
  onLaneHeightChange: React.Dispatch<React.SetStateAction<number>>
  onPositionedAnnotationsChange: React.Dispatch<React.SetStateAction<PaperAnnotation[]>>
  onAnnotationHighlightsChange: React.Dispatch<
    React.SetStateAction<
      Array<{ annotationId: string; rects: Array<{ top: number; left: number; width: number; height: number }> }>
    >
  >
  onSearchHighlightRectsChange: React.Dispatch<
    React.SetStateAction<Array<{ top: number; left: number; width: number; height: number }>>
  >
  onSearchHighlightTopChange: React.Dispatch<React.SetStateAction<number | null>>
  onSearchHighlightHeightChange: React.Dispatch<React.SetStateAction<number | null>>
  onFlashAnnotationIdChange: React.Dispatch<React.SetStateAction<string | null>>
  onFlashSearchHighlightChange: React.Dispatch<React.SetStateAction<boolean>>
  onToolbarSelectionChange: React.Dispatch<React.SetStateAction<unknown>>
}

export function useReaderLocatorEffects({
  articleRef,
  articleShellRef,
  outline,
  markdown,
  annotations,
  positionedAnnotations,
  activeView,
  detail,
  draft,
  focusedAnnotationId,
  requestedBlockId,
  requestedAnnotationId,
  requestedBodyQuote,
  requestedBodyContextBefore,
  requestedBodyContextAfter,
  searchHighlightTop,
  onActiveSectionIdChange,
  onLaneHeightChange,
  onPositionedAnnotationsChange,
  onAnnotationHighlightsChange,
  onSearchHighlightRectsChange,
  onSearchHighlightTopChange,
  onSearchHighlightHeightChange,
  onFlashAnnotationIdChange,
  onFlashSearchHighlightChange,
  onToolbarSelectionChange,
}: UseReaderLocatorEffectsArgs) {
  useEffect(() => {
    const container = articleRef.current
    if (!container) {
      return
    }

    const headings = Array.from(container.querySelectorAll('h1, h2, h3, h4, h5, h6'))
    headings.forEach((element, index) => {
      if (!element.id) {
        element.setAttribute('id', outline[index]?.id ?? `section-${index + 1}`)
      }
    })

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0]

        if (visible?.target instanceof HTMLElement) {
          onActiveSectionIdChange(visible.target.id)
        }
      },
      {
        rootMargin: '-25% 0px -55% 0px',
        threshold: [0.1, 0.4, 0.7],
      },
    )

    headings.forEach((element) => observer.observe(element))

    return () => {
      observer.disconnect()
    }
  }, [articleRef, markdown, onActiveSectionIdChange, outline])

  useEffect(() => {
    const articleShell = articleShellRef.current
    if (!articleShell) {
      return
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) {
        onLaneHeightChange(entry.contentRect.height)
      }
    })
    observer.observe(articleShell)
    onLaneHeightChange(articleShell.getBoundingClientRect().height)

    return () => {
      observer.disconnect()
    }
  }, [annotations.length, articleShellRef, draft, markdown, onLaneHeightChange])

  useEffect(() => {
    const articleContainer = articleRef.current
    const articleShell = articleShellRef.current
    if (!articleContainer || !articleShell) {
      onPositionedAnnotationsChange(annotations)
      onAnnotationHighlightsChange([])
      return
    }

    let animationFrame = 0
    const recompute = () => {
      const nextHighlights: Array<{
        annotationId: string
        rects: Array<{ top: number; left: number; width: number; height: number }>
      }> = []
      const nextAnnotations = annotations.map((annotation) => {
        if (annotation.view !== activeView) {
          return annotation
        }
        const resolved = resolveAnnotationHighlight(articleContainer, articleShell, annotation)
        if (!resolved) {
          return annotation
        }
        if (!annotation.archived) {
          nextHighlights.push({ annotationId: annotation.id, rects: resolved.rects })
        }
        return { ...annotation, anchorTop: resolved.top, anchorHeight: resolved.height }
      })
      onPositionedAnnotationsChange(nextAnnotations)
      onAnnotationHighlightsChange(nextHighlights)
    }

    const scheduleRecompute = () => {
      window.cancelAnimationFrame(animationFrame)
      animationFrame = window.requestAnimationFrame(recompute)
    }

    scheduleRecompute()
    const observer = new ResizeObserver(() => {
      scheduleRecompute()
    })
    observer.observe(articleContainer)
    observer.observe(articleShell)
    window.addEventListener('resize', scheduleRecompute)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', scheduleRecompute)
      window.cancelAnimationFrame(animationFrame)
    }
  }, [
    activeView,
    annotations,
    articleRef,
    articleShellRef,
    markdown,
    onAnnotationHighlightsChange,
    onPositionedAnnotationsChange,
  ])

  useEffect(() => {
    const articleContainer = articleRef.current
    const articleShell = articleShellRef.current
    if (!articleContainer || !articleShell || !requestedBodyQuote) {
      onSearchHighlightRectsChange([])
      onSearchHighlightTopChange(null)
      onSearchHighlightHeightChange(null)
      return
    }

    const resolved = resolveAnnotationHighlight(articleContainer, articleShell, {
      quote: requestedBodyQuote,
      contextBefore: requestedBodyContextBefore,
      contextAfter: requestedBodyContextAfter,
    })
    if (!resolved) {
      onSearchHighlightRectsChange([])
      onSearchHighlightTopChange(null)
      onSearchHighlightHeightChange(null)
      return
    }

    onSearchHighlightRectsChange(resolved.rects)
    onSearchHighlightTopChange(resolved.top)
    onSearchHighlightHeightChange(resolved.height)
  }, [
    activeView,
    articleRef,
    articleShellRef,
    markdown,
    onSearchHighlightHeightChange,
    onSearchHighlightRectsChange,
    onSearchHighlightTopChange,
    requestedBodyContextAfter,
    requestedBodyContextBefore,
    requestedBodyQuote,
  ])

  useEffect(() => {
    const articleShell = articleShellRef.current
    if (!articleShell || !focusedAnnotationId) {
      return
    }
    const targetAnnotation = positionedAnnotations.find(
      (annotation) => annotation.id === focusedAnnotationId && annotation.view === activeView,
    )
    if (!targetAnnotation) {
      return
    }

    const shellRect = articleShell.getBoundingClientRect()
    const absoluteTop = window.scrollY + shellRect.top + Math.max(targetAnnotation.anchorTop - 140, 0)
    window.scrollTo({ top: absoluteTop, behavior: 'auto' })
    onFlashAnnotationIdChange(focusedAnnotationId)

    const timeout = window.setTimeout(() => {
      onFlashAnnotationIdChange((current) => (current === focusedAnnotationId ? null : current))
    }, 2200)

    return () => {
      window.clearTimeout(timeout)
      onFlashAnnotationIdChange((current) => (current === focusedAnnotationId ? null : current))
    }
  }, [activeView, articleShellRef, focusedAnnotationId, onFlashAnnotationIdChange, positionedAnnotations])

  useEffect(() => {
    const articleShell = articleShellRef.current
    if (!articleShell || !requestedBodyQuote || searchHighlightTop === null) {
      return
    }
    const shellRect = articleShell.getBoundingClientRect()
    const absoluteTop = window.scrollY + shellRect.top + Math.max(searchHighlightTop - 140, 0)
    window.scrollTo({ top: absoluteTop, behavior: 'auto' })
    onFlashSearchHighlightChange(true)

    const timeout = window.setTimeout(() => {
      onFlashSearchHighlightChange(false)
    }, 2200)

    return () => {
      window.clearTimeout(timeout)
      onFlashSearchHighlightChange(false)
    }
  }, [articleShellRef, onFlashSearchHighlightChange, requestedBodyQuote, searchHighlightTop])

  useEffect(() => {
    const articleContainer = articleRef.current
    if (!articleContainer) {
      return
    }

    clearLocatorHighlights(articleContainer)
    if (!detail || !requestedBlockId || requestedAnnotationId || requestedBodyQuote) {
      return
    }

    const targetBlock = detail.blocks.find((block) => block.id === requestedBlockId)
    if (!targetBlock) {
      return
    }

    activateLocatedNode(locateBlockNode(articleContainer, targetBlock))
    return () => {
      clearLocatorHighlights(articleContainer)
    }
  }, [articleRef, detail, markdown, requestedAnnotationId, requestedBlockId, requestedBodyQuote])

  useEffect(() => {
    const handleWindowChange = () => {
      onToolbarSelectionChange(null)
    }
    const handleSelectionChange = () => {
      const selection = window.getSelection()
      if (!selection || selection.isCollapsed) {
        onToolbarSelectionChange(null)
      }
    }

    window.addEventListener('scroll', handleWindowChange, true)
    window.addEventListener('resize', handleWindowChange)
    document.addEventListener('selectionchange', handleSelectionChange)

    return () => {
      window.removeEventListener('scroll', handleWindowChange, true)
      window.removeEventListener('resize', handleWindowChange)
      document.removeEventListener('selectionchange', handleSelectionChange)
    }
  }, [onToolbarSelectionChange])
}
