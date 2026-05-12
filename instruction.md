# GenealogIQ — Full MVP Specification
### Genealogy Image Processing Pipeline with AI-Powered OCR, Record Extraction & Family Tree Generation

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Tech Stack](#2-tech-stack)
3. [UI Design System & Light Theme](#3-ui-design-system--light-theme)
4. [System Architecture](#4-system-architecture)
5. [Folder & File Structure](#5-folder--file-structure)
6. [Database Schema (SQLite)](#6-database-schema-sqlite)
7. [Authentication Module](#7-authentication-module)
8. [Project & Batch Management](#8-project--batch-management)
9. [Stage 1 — VisionMax (Image Enhancement)](#9-stage-1--visionmax-image-enhancement)
10. [Stage 2 — TextIQ (OCR)](#10-stage-2--textiq-ocr)
11. [Stage 3 — IndexGenius (Record Extraction)](#11-stage-3--indexgenius-record-extraction)
12. [Stage 4 — GedcomX Generator](#12-stage-4--gedcomx-generator)
13. [Stage 5 — Tree Viewer](#13-stage-5--tree-viewer)
14. [Backend API Reference](#14-backend-api-reference)
15. [Frontend Pages & Components](#15-frontend-pages--components)
16. [File Storage Strategy](#16-file-storage-strategy)
17. [OpenAI Integration](#17-openai-integration)
18. [LangChain Integration](#18-langchain-integration)
19. [Environment & Configuration](#19-environment--configuration)
20. [Setup & Run Instructions](#20-setup--run-instructions)
21. [MVP Build Sequence](#21-mvp-build-sequence)

---

## 1. Project Overview

**GenealogIQ** is a web-based genealogy document processing pipeline. Users upload scanned images of historical records (birth registers, death registers, census sheets, parish records, etc.) and process them through five sequential AI-powered stages:

| Stage | Name | Description |
|-------|------|-------------|
| 1 | **VisionMax** | Color correction & minor image enhancement (optional, with undo) |
| 2 | **TextIQ** | OCR via OpenAI Vision API, editable text with revert |
| 3 | **IndexGenius** | Structured record extraction (names, dates, relations) |
| 4 | **GedcomX Generator** | Family tree structure generation per record |
| 5 | **Tree Viewer** | Visual, navigatable family tree for each record |

---

## 2. Tech Stack

### Backend
- **Runtime**: Python 3.11+
- **Framework**: FastAPI
- **Database**: SQLite via SQLAlchemy ORM (async)
- **Auth**: JWT (python-jose) + bcrypt password hashing (passlib)
- **Image Processing**: Pillow, OpenCV (cv2)
- **AI / LLM**: OpenAI SDK (>=1.0), LangChain, LangChain-OpenAI
- **GedcomX**: Custom serializer (JSON-based GedcomX spec)
- **File Handling**: Python pathlib + shutil

### Frontend
- **Framework**: React 18 (Vite)
- **Routing**: React Router v6
- **State**: Zustand (global), React Query (server state)
- **UI**: Tailwind CSS + shadcn/ui components
- **Image Viewer**: react-zoom-pan-pinch
- **Tree Viewer**: react-d3-tree or custom D3 SVG
- **HTTP Client**: Axios

### Infrastructure
- **API Server**: Uvicorn
- **File storage**: Local filesystem (structured folders)
- **CORS**: FastAPI middleware

---

## 3. UI Design System & Light Theme

> **Mandate: The entire application uses a beautiful, warm light theme exclusively. Dark mode is not implemented. The aesthetic should feel like a premium archival research tool — clean, scholarly, trustworthy, and inviting.**

### Design Philosophy

GenealogIQ processes historical documents — the visual design should evoke the warmth of archival paper, aged parchment, and scholarly precision, while remaining crisp and modern. Think of it as a high-end research portal: warm off-whites, rich earth tones, deep sepia accents, with brilliant amber as the primary action color.

The UI must feel **calm and focused** — users are doing careful, detail-oriented work. No jarring contrasts, no aggressive colors, no clutter.

---

### Color Palette

#### Primary Brand Colors

| Token | Hex | Usage |
|-------|-----|-------|
| `brand-amber` | `#D97706` | Primary CTA buttons, active states, key highlights |
| `brand-amber-light` | `#FEF3C7` | Button hover backgrounds, selected states |
| `brand-amber-dark` | `#92400E` | Button pressed, deep accents |
| `brand-sepia` | `#78350F` | Logo, primary headings, high-emphasis text |

#### Background Colors

| Token | Hex | Usage |
|-------|-----|-------|
| `bg-canvas` | `#FAFAF8` | Page/app background — warm off-white, not pure white |
| `bg-surface` | `#FFFFFF` | Cards, panels, modal backgrounds |
| `bg-surface-raised` | `#F5F3EF` | Sidebar, secondary panels — warm parchment tint |
| `bg-surface-sunken` | `#EDE9E3` | Input fields, code blocks, inset areas |
| `bg-overlay` | `rgba(120, 53, 15, 0.04)` | Hover states on list items |

#### Text Colors

| Token | Hex | Usage |
|-------|-----|-------|
| `text-primary` | `#1C1917` | Main body text, labels |
| `text-secondary` | `#57534E` | Supporting text, descriptions, placeholders |
| `text-tertiary` | `#A8A29E` | Timestamps, meta info, disabled text |
| `text-inverse` | `#FFFFFF` | Text on dark/colored backgrounds |
| `text-accent` | `#D97706` | Links, interactive labels |

#### Border Colors

| Token | Hex | Usage |
|-------|-----|-------|
| `border-subtle` | `#E7E4DF` | Card borders, dividers — warm-toned, not cold grey |
| `border-default` | `#D6D2CB` | Input borders, panel separators |
| `border-strong` | `#A8A29E` | Focused inputs, prominent separators |
| `border-accent` | `#D97706` | Active/focused input rings, selected item borders |

#### Stage / Status Colors (all light-theme safe)

| Stage | Background | Text | Border |
|-------|-----------|------|--------|
| Pending | `#F5F3EF` | `#78716C` | `#D6D2CB` |
| In Progress | `#FEF3C7` | `#92400E` | `#FCD34D` |
| Complete | `#DCFCE7` | `#14532D` | `#86EFAC` |
| Skipped | `#F1F5F9` | `#475569` | `#CBD5E1` |
| Error | `#FEF2F2` | `#991B1B` | `#FECACA` |

#### Semantic Colors

| Token | Hex | Usage |
|-------|-----|-------|
| `success` | `#16A34A` | Save confirmations, completed badges |
| `warning` | `#D97706` | Unsaved changes, caution states |
| `error` | `#DC2626` | Validation errors, delete confirmations |
| `info` | `#2563EB` | Informational toasts, tips |

---

### Typography

```css
/* Font Stack */
--font-display:  'Playfair Display', Georgia, serif;  /* Headings, logo */
--font-body:     'Inter', system-ui, sans-serif;       /* Body text, UI */
--font-mono:     'JetBrains Mono', 'Fira Code', monospace; /* OCR text, code */

/* Scale */
--text-xs:    0.75rem;   /* 12px — meta, timestamps */
--text-sm:    0.875rem;  /* 14px — labels, supporting */
--text-base:  1rem;      /* 16px — body text */
--text-lg:    1.125rem;  /* 18px — subheadings */
--text-xl:    1.25rem;   /* 20px — section titles */
--text-2xl:   1.5rem;    /* 24px — page titles */
--text-3xl:   1.875rem;  /* 30px — dashboard hero */
--text-4xl:   2.25rem;   /* 36px — login page title */
```

**Font loading in `index.html`:**
```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700&family=Inter:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
```

---

### Spacing & Radius

```css
/* Consistent spacing scale */
--space-1:  0.25rem;   /* 4px */
--space-2:  0.5rem;    /* 8px */
--space-3:  0.75rem;   /* 12px */
--space-4:  1rem;      /* 16px */
--space-6:  1.5rem;    /* 24px */
--space-8:  2rem;      /* 32px */
--space-12: 3rem;      /* 48px */
--space-16: 4rem;      /* 64px */

/* Border radius */
--radius-sm:   4px;    /* Badges, small chips */
--radius-md:   8px;    /* Buttons, inputs */
--radius-lg:   12px;   /* Cards, panels */
--radius-xl:   16px;   /* Modals, large surfaces */
--radius-full: 9999px; /* Pills, avatars */
```

---

### Shadows (warm-tinted, never cold blue-grey)

```css
--shadow-xs:  0 1px 2px rgba(120, 53, 15, 0.04);
--shadow-sm:  0 1px 3px rgba(120, 53, 15, 0.08), 0 1px 2px rgba(120, 53, 15, 0.04);
--shadow-md:  0 4px 6px rgba(120, 53, 15, 0.07), 0 2px 4px rgba(120, 53, 15, 0.05);
--shadow-lg:  0 10px 15px rgba(120, 53, 15, 0.08), 0 4px 6px rgba(120, 53, 15, 0.04);
--shadow-xl:  0 20px 25px rgba(120, 53, 15, 0.10), 0 8px 10px rgba(120, 53, 15, 0.04);
```

---

### Tailwind Configuration — `tailwind.config.js`

```javascript
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{js,jsx}'],
  // NO darkMode setting — light theme only
  theme: {
    extend: {
      colors: {
        brand: {
          amber:      '#D97706',
          'amber-light': '#FEF3C7',
          'amber-dark':  '#92400E',
          sepia:      '#78350F',
        },
        surface: {
          canvas:  '#FAFAF8',
          DEFAULT: '#FFFFFF',
          raised:  '#F5F3EF',
          sunken:  '#EDE9E3',
        },
        ink: {
          DEFAULT:   '#1C1917',
          secondary: '#57534E',
          tertiary:  '#A8A29E',
          accent:    '#D97706',
        },
        line: {
          subtle:  '#E7E4DF',
          DEFAULT: '#D6D2CB',
          strong:  '#A8A29E',
          accent:  '#D97706',
        },
      },
      fontFamily: {
        display: ['"Playfair Display"', 'Georgia', 'serif'],
        body:    ['Inter', 'system-ui', 'sans-serif'],
        mono:    ['"JetBrains Mono"', '"Fira Code"', 'monospace'],
      },
      boxShadow: {
        'warm-xs': '0 1px 2px rgba(120,53,15,0.04)',
        'warm-sm': '0 1px 3px rgba(120,53,15,0.08), 0 1px 2px rgba(120,53,15,0.04)',
        'warm-md': '0 4px 6px rgba(120,53,15,0.07), 0 2px 4px rgba(120,53,15,0.05)',
        'warm-lg': '0 10px 15px rgba(120,53,15,0.08), 0 4px 6px rgba(120,53,15,0.04)',
        'warm-xl': '0 20px 25px rgba(120,53,15,0.10), 0 8px 10px rgba(120,53,15,0.04)',
      },
      borderRadius: {
        DEFAULT: '8px',
      },
    },
  },
  plugins: [],
}
```

---

### Global CSS — `src/index.css`

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

/* Force light theme — never inherit OS dark preference */
:root {
  color-scheme: light only;
}

html, body {
  background-color: #FAFAF8;
  color: #1C1917;
  font-family: 'Inter', system-ui, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

/* Scrollbar — warm-toned, not default grey */
::-webkit-scrollbar { width: 8px; height: 8px; }
::-webkit-scrollbar-track { background: #F5F3EF; }
::-webkit-scrollbar-thumb { background: #D6D2CB; border-radius: 4px; }
::-webkit-scrollbar-thumb:hover { background: #A8A29E; }

/* Selection highlight */
::selection { background: #FEF3C7; color: #78350F; }

/* Focus ring — amber, not blue */
*:focus-visible {
  outline: 2px solid #D97706;
  outline-offset: 2px;
}

/* Reusable component classes */
@layer components {

  /* Primary button */
  .btn-primary {
    @apply bg-brand-amber text-white font-medium px-4 py-2 rounded-md
           hover:bg-brand-amber-dark active:scale-95
           transition-all duration-150 shadow-warm-sm
           focus-visible:ring-2 focus-visible:ring-brand-amber focus-visible:ring-offset-2;
  }

  /* Secondary button */
  .btn-secondary {
    @apply bg-surface-raised text-ink border border-line
           font-medium px-4 py-2 rounded-md
           hover:bg-surface-sunken hover:border-line-strong
           active:scale-95 transition-all duration-150 shadow-warm-xs;
  }

  /* Ghost button */
  .btn-ghost {
    @apply text-ink-secondary font-medium px-3 py-2 rounded-md
           hover:bg-surface-raised hover:text-ink
           active:scale-95 transition-all duration-150;
  }

  /* Danger button */
  .btn-danger {
    @apply bg-red-600 text-white font-medium px-4 py-2 rounded-md
           hover:bg-red-700 active:scale-95
           transition-all duration-150 shadow-warm-sm;
  }

  /* Card */
  .card {
    @apply bg-surface rounded-xl border border-line-subtle shadow-warm-sm
           hover:shadow-warm-md transition-shadow duration-200;
  }

  /* Input */
  .input {
    @apply w-full bg-surface-sunken border border-line rounded-md
           px-3 py-2 text-ink placeholder:text-ink-tertiary
           focus:outline-none focus:border-line-accent
           focus:ring-2 focus:ring-brand-amber/20
           transition-colors duration-150;
  }

  /* Badge — status */
  .badge-pending    { @apply bg-surface-raised text-ink-secondary border border-line text-xs font-medium px-2 py-0.5 rounded-full; }
  .badge-progress   { @apply bg-brand-amber-light text-brand-amber-dark border border-yellow-300 text-xs font-medium px-2 py-0.5 rounded-full; }
  .badge-complete   { @apply bg-green-50 text-green-800 border border-green-200 text-xs font-medium px-2 py-0.5 rounded-full; }
  .badge-skipped    { @apply bg-slate-50 text-slate-600 border border-slate-200 text-xs font-medium px-2 py-0.5 rounded-full; }
  .badge-error      { @apply bg-red-50 text-red-800 border border-red-200 text-xs font-medium px-2 py-0.5 rounded-full; }

  /* Section heading */
  .heading-display  { @apply font-display text-brand-sepia; }
  .heading-page     { @apply text-2xl font-semibold text-ink; }
  .heading-section  { @apply text-lg font-semibold text-ink; }
}
```

---

### Component Design Specifications

#### Sidebar
```
Background:     #F5F3EF  (surface-raised — warm parchment)
Border-right:   1px solid #E7E4DF
Width:          260px (desktop), collapsible on mobile

Logo area:      Playfair Display, brand-sepia color, with small tree/leaf icon in amber
Active nav:     bg-brand-amber-light, left border 3px brand-amber, text brand-sepia
Hover nav:      bg-surface-sunken
User avatar:    Amber circle, white initials, bottom of sidebar
```

#### Top Navbar
```
Background:     #FFFFFF
Border-bottom:  1px solid #E7E4DF
Shadow:         shadow-warm-xs
Height:         56px
Content:        Breadcrumb (left) + Stage Progress (center) + User menu (right)
```

#### Cards (Project & Batch)
```
Background:     #FFFFFF
Border:         1px solid #E7E4DF
Border-radius:  12px
Shadow:         shadow-warm-sm → shadow-warm-md on hover
Padding:        24px
Accent stripe:  3px left border in brand-amber (or stage color)
```

#### Stage Progress Bar
```
Track:          #E7E4DF
Completed fill: #D97706 (amber)
Current node:   Amber ring, white fill, amber icon
Future node:    #E7E4DF fill, ink-tertiary text
Connector line: 2px solid, completed segments amber, future segments #E7E4DF
```

#### Image Grid (Batch thumbnails)
```
Background:     #F5F3EF
Image border:   1px solid #E7E4DF
Selected:       3px amber border, amber overlay badge
Hover:          scale-105, shadow-warm-md
Status chip:    Bottom-right overlay, semi-transparent warm white bg
```

#### Login / Register Page
```
Left panel (60%):  Brand illustration or archival document collage
                   Gradient: from #78350F (sepia) to #D97706 (amber)
                   Quote: Playfair Display italic, white, genealogy-themed
Right panel (40%): #FFFFFF, centered form, Playfair Display heading
                   Logo with amber tree icon at top
                   Input fields: surface-sunken bg, amber focus ring
                   Primary CTA: full-width btn-primary
```

#### Side-by-side Editor (TextIQ / IndexGenius)
```
Left panel:     Image viewer — bg-surface-sunken, rounded-lg border
Right panel:    Text editor — bg-surface, border border-line, rounded-lg
Divider:        2px solid #E7E4DF, draggable (resize panels)
Toolbar:        bg-surface-raised, border-bottom border-line-subtle
                Sticky top within panel
```

#### Table (IndexGenius record fields)
```
Header row:     bg-surface-raised, text-ink-secondary, text-sm font-medium
Body rows:      bg-surface, border-bottom border-line-subtle
Hover row:      bg-surface-raised (very subtle)
Edited cell:    bg-brand-amber-light, border-left 2px brand-amber
Input in cell:  bg-surface-sunken, amber focus ring
```

#### Family Tree Nodes
```
Primary person: Amber fill (#D97706), white text, bold, larger size
Father/Mother:  Deep blue (#1D4ED8 bg, white text)
Spouse:         Rose (#BE185D bg, white text)
Children:       Emerald (#065F46 bg, white text)
Siblings:       Indigo (#4338CA bg, white text)
Other kin:      Warm grey (#57534E bg, white text)
Edges/lines:    #D6D2CB (line-default), 2px, curved bezier
Canvas bg:      #FAFAF8 (canvas)
```

---

### Animation & Transitions

```css
/* All transitions use ease-out for snappy feel */
--transition-fast:   150ms ease-out;   /* Hover states, button press */
--transition-normal: 250ms ease-out;   /* Panel slides, dropdown open */
--transition-slow:   400ms ease-out;   /* Page transitions, modal appear */

/* Micro-interactions */
.btn-primary:active  { transform: scale(0.97); }
.card:hover          { transform: translateY(-1px); }
.nav-item:hover      { padding-left: +2px (via padding transition); }
```

**Loading states:**
- Skeleton screens use warm gradient shimmer: `#F5F3EF → #EDE9E3 → #F5F3EF`
- Spinner color: `brand-amber`
- Toast notifications: warm white card, amber left-border for info/success

---

### Page-by-Page Visual Notes

| Page | Key Visual Detail |
|------|------------------|
| Login | Split layout — amber/sepia gradient left, clean white form right |
| Dashboard | Hero greeting in Playfair Display; project cards in a responsive grid |
| ProjectDetail | Batch list as horizontal cards with amber progress bar per stage |
| BatchDetail | Image mosaic grid — thumbnails with status chips overlay |
| VisionMax | Dark-ish image canvas area (exception: canvas bg is `#2D2B27` for contrast) surrounded by light chrome |
| TextIQ | Warm split view — parchment-tinted image panel, white text editor |
| IndexGenius | Structured table with amber-tinted edited rows |
| TreeViewer | White canvas with warm-colored nodes, minimal chrome |

> **Exception — VisionMax image canvas**: The image editing canvas itself uses a dark neutral (`#2D2B27`) background so that image colors read true. All surrounding UI chrome (toolbar, sidebar, panels) remains the full light theme. This is not a dark mode — it is a photographic lightbox convention.

---

### No Dark Mode — Implementation Notes

- **Do not** include `darkMode: 'class'` or `darkMode: 'media'` in `tailwind.config.js`
- **Add** `color-scheme: light only` in `:root` CSS to prevent OS-level dark mode inheritance
- **Do not** use any `dark:` Tailwind variants anywhere in the codebase
- **Avoid** pure `#FFFFFF` page backgrounds — use `#FAFAF8` (canvas) for warmth
- **Avoid** pure `#000000` text — use `#1C1917` (ink) for softness
- All shadcn/ui component overrides must replace their default grey palette with the warm palette above

---

## 4. System Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     React Frontend                       │
│  Auth → Projects → Batches → VisionMax → TextIQ →       │
│  IndexGenius → GedcomX → TreeViewer                     │
└────────────────────┬────────────────────────────────────┘
                     │ HTTP / REST
┌────────────────────▼────────────────────────────────────┐
│                   FastAPI Backend                        │
│                                                          │
│  /auth   /projects   /batches   /images                  │
│  /visionmax   /textiq   /indexgenius                     │
│  /gedcomx   /treeviewer                                  │
└──────┬──────────────────┬───────────────────────────────┘
       │                  │
  ┌────▼────┐      ┌──────▼──────────────────────┐
  │ SQLite  │      │   Filesystem Storage         │
  │  DB     │      │  /storage/                   │
  │         │      │    projects/{id}/            │
  │ Users   │      │    batches/{id}/             │
  │ Projects│      │    images/original/          │
  │ Batches │      │    images/enhanced/          │
  │ Images  │      │    images/enhanced_backup/   │
  │ Records │      │    text/current/             │
  │ Trees   │      │    text/original/            │
  └─────────┘      │    gedcomx/                  │
                   └─────────────────────────────┘
                          │
              ┌───────────▼───────────┐
              │    OpenAI API         │
              │  gpt-4o (vision+text) │
              └───────────────────────┘
```

---

## 5. Folder & File Structure

```
genealogiq/
├── backend/
│   ├── main.py                    # FastAPI app entry point
│   ├── config.py                  # Settings, env vars
│   ├── database.py                # SQLAlchemy engine + session
│   ├── models/
│   │   ├── __init__.py
│   │   ├── user.py
│   │   ├── project.py
│   │   ├── batch.py
│   │   ├── image.py
│   │   ├── record.py
│   │   └── gedcomx.py
│   ├── schemas/
│   │   ├── auth.py
│   │   ├── project.py
│   │   ├── batch.py
│   │   ├── image.py
│   │   ├── record.py
│   │   └── gedcomx.py
│   ├── routers/
│   │   ├── auth.py
│   │   ├── projects.py
│   │   ├── batches.py
│   │   ├── images.py
│   │   ├── visionmax.py
│   │   ├── textiq.py
│   │   ├── indexgenius.py
│   │   ├── gedcomx.py
│   │   └── treeviewer.py
│   ├── services/
│   │   ├── auth_service.py
│   │   ├── file_service.py
│   │   ├── visionmax_service.py
│   │   ├── textiq_service.py
│   │   ├── indexgenius_service.py
│   │   ├── gedcomx_service.py
│   │   └── openai_service.py
│   ├── core/
│   │   ├── security.py            # JWT, password hashing
│   │   └── dependencies.py        # get_current_user, get_db
│   └── requirements.txt
│
├── frontend/
│   ├── src/
│   │   ├── main.jsx
│   │   ├── App.jsx
│   │   ├── api/
│   │   │   ├── axios.js
│   │   │   ├── auth.js
│   │   │   ├── projects.js
│   │   │   ├── batches.js
│   │   │   ├── images.js
│   │   │   ├── visionmax.js
│   │   │   ├── textiq.js
│   │   │   ├── indexgenius.js
│   │   │   ├── gedcomx.js
│   │   │   └── treeviewer.js
│   │   ├── store/
│   │   │   ├── authStore.js
│   │   │   └── pipelineStore.js
│   │   ├── pages/
│   │   │   ├── Login.jsx
│   │   │   ├── Register.jsx
│   │   │   ├── Dashboard.jsx
│   │   │   ├── ProjectDetail.jsx
│   │   │   ├── BatchDetail.jsx
│   │   │   ├── VisionMax.jsx
│   │   │   ├── TextIQ.jsx
│   │   │   ├── IndexGenius.jsx
│   │   │   ├── GedcomXView.jsx
│   │   │   └── TreeViewer.jsx
│   │   ├── components/
│   │   │   ├── Layout/
│   │   │   │   ├── Sidebar.jsx
│   │   │   │   ├── Navbar.jsx
│   │   │   │   └── StageProgress.jsx
│   │   │   ├── Project/
│   │   │   │   ├── ProjectCard.jsx
│   │   │   │   └── ProjectForm.jsx
│   │   │   ├── Batch/
│   │   │   │   ├── BatchCard.jsx
│   │   │   │   ├── BatchForm.jsx
│   │   │   │   └── ImageUploader.jsx
│   │   │   ├── Image/
│   │   │   │   ├── ImageViewer.jsx
│   │   │   │   └── ImageGrid.jsx
│   │   │   ├── VisionMax/
│   │   │   │   ├── EnhancementControls.jsx
│   │   │   │   └── BeforeAfterSlider.jsx
│   │   │   ├── TextIQ/
│   │   │   │   ├── SideBySideView.jsx
│   │   │   │   └── TextEditor.jsx
│   │   │   ├── IndexGenius/
│   │   │   │   ├── RecordTable.jsx
│   │   │   │   └── RecordEditor.jsx
│   │   │   └── Tree/
│   │   │       ├── FamilyTree.jsx
│   │   │       └── TreeNode.jsx
│   │   └── utils/
│   │       ├── stageStatus.js
│   │       └── formatters.js
│   ├── index.html
│   ├── vite.config.js
│   ├── tailwind.config.js
│   └── package.json
│
├── storage/                       # Created at runtime
│   └── users/
│       └── {user_id}/
│           └── projects/
│               └── {project_id}/
│                   └── batches/
│                       └── {batch_id}/
│                           ├── images/
│                           │   ├── original/          # Immutable original uploads
│                           │   ├── enhanced/          # Current enhanced image
│                           │   └── enhanced_backup/   # Pre-edit backup (undo source)
│                           ├── text/
│                           │   ├── current/           # Active OCR text
│                           │   └── original/          # First OCR result (revert source)
│                           ├── records/               # IndexGenius JSON outputs
│                           └── gedcomx/               # GedcomX JSON files
│
├── .env
└── docker-compose.yml             # Optional
```

---

## 6. Database Schema (SQLite)

### users
```sql
CREATE TABLE users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    email       TEXT UNIQUE NOT NULL,
    username    TEXT UNIQUE NOT NULL,
    hashed_password TEXT NOT NULL,
    is_active   BOOLEAN DEFAULT TRUE,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### projects
```sql
CREATE TABLE projects (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    description TEXT,
    status      TEXT DEFAULT 'active',   -- active | archived
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### batches
```sql
CREATE TABLE batches (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    description TEXT,
    status      TEXT DEFAULT 'pending',
    -- pending | visionmax | textiq | indexgenius | gedcomx | complete
    image_count INTEGER DEFAULT 0,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### images
```sql
CREATE TABLE images (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id            INTEGER NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
    original_filename   TEXT NOT NULL,
    original_path       TEXT NOT NULL,    -- storage path to original
    enhanced_path       TEXT,             -- current enhanced version path
    enhanced_backup_path TEXT,            -- backup path (for undo)
    has_enhancement     BOOLEAN DEFAULT FALSE,
    visionmax_status    TEXT DEFAULT 'pending',  -- pending | done | skipped
    textiq_status       TEXT DEFAULT 'pending',
    indexgenius_status  TEXT DEFAULT 'pending',
    gedcomx_status      TEXT DEFAULT 'pending',
    sort_order          INTEGER DEFAULT 0,
    created_at          DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### ocr_texts
```sql
CREATE TABLE ocr_texts (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    image_id        INTEGER UNIQUE NOT NULL REFERENCES images(id) ON DELETE CASCADE,
    current_text    TEXT,              -- Editable, user-modified
    original_text   TEXT,             -- First OCR result; never overwritten
    has_edits       BOOLEAN DEFAULT FALSE,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### records
```sql
CREATE TABLE records (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    image_id        INTEGER NOT NULL REFERENCES images(id) ON DELETE CASCADE,
    record_number   TEXT,
    event_type      TEXT,   -- birth | death | marriage | baptism | burial | other
    given_name      TEXT,
    surname         TEXT,
    date_of_birth   TEXT,
    date_of_death   TEXT,
    date_of_event   TEXT,
    father_name     TEXT,
    mother_name     TEXT,
    family_members  TEXT,   -- JSON: [{name, relation}]  -- only family relations
    additional_info TEXT,   -- JSON: any other extracted fields
    raw_extracted   TEXT,   -- JSON: full AI extraction for reference
    has_edits       BOOLEAN DEFAULT FALSE,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### gedcomx_records
```sql
CREATE TABLE gedcomx_records (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    record_id   INTEGER UNIQUE NOT NULL REFERENCES records(id) ON DELETE CASCADE,
    gedcomx_json TEXT NOT NULL,        -- Full GedcomX JSON
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

## 7. Authentication Module

### Backend — `routers/auth.py`

**Endpoints:**

```
POST /auth/register
  Body: { email, username, password }
  Returns: { user_id, email, username }

POST /auth/login
  Body: { username, password }  (OAuth2 form)
  Returns: { access_token, token_type }

GET  /auth/me
  Header: Authorization: Bearer <token>
  Returns: { id, email, username }
```

### Security — `core/security.py`

- Passwords hashed with **bcrypt** via `passlib`
- JWT tokens signed with `HS256`, expiry: 24 hours
- `get_current_user` dependency injected into all protected routes

### Frontend — Login/Register Pages

- Login form with email/password, stores JWT in `localStorage`
- Axios interceptor attaches `Authorization: Bearer <token>` header
- Protected routes via `<PrivateRoute>` wrapper component
- Zustand `authStore` holds `{ user, token, login(), logout() }`

---

## 8. Project & Batch Management

### Projects

**Backend endpoints:**
```
GET    /projects/                  List all projects for current user
POST   /projects/                  Create project { name, description }
GET    /projects/{id}              Get project detail + batch list
PUT    /projects/{id}              Update project name/description
DELETE /projects/{id}              Delete project + all batches + images + files
```

**Frontend:**
- **Dashboard** shows project cards with batch count, last updated, stage progress summary
- **Create Project** modal with name + description
- **Edit/Delete** via kebab menu on project card
- Clicking a project opens `ProjectDetail` page

### Batches

**Backend endpoints:**
```
GET    /batches/?project_id={id}   List batches in a project
POST   /batches/                   Create batch { project_id, name, description }
GET    /batches/{id}               Get batch with images list
PUT    /batches/{id}               Update batch name/description
DELETE /batches/{id}               Delete batch + all images + files
POST   /batches/{id}/upload        Upload images (multipart, multiple files)
```

**Upload behavior:**
- Accepts: JPG, PNG, TIFF, BMP, WEBP
- Each image saved to `storage/users/{uid}/projects/{pid}/batches/{bid}/images/original/`
- Filename sanitized and made unique with UUID suffix
- DB record created for each image
- `batch.image_count` updated
- Returns list of created image objects

**Frontend:**
- `BatchDetail` page shows image grid with status chips per stage
- `ImageUploader` — drag-and-drop zone with progress bars
- Batch has **stage progress indicator** (5 stages shown as pipeline steps)
- Batch and project are **editable** (inline rename) and **deletable** (with confirmation modal)

---

## 9. Stage 1 — VisionMax (Image Enhancement)

### Purpose
Optional color correction and minor image enhancement per image or in bulk for the whole batch. All changes are non-destructive — original images are never modified.

### Backend — `routers/visionmax.py`

```
GET  /visionmax/batch/{batch_id}           List images with enhancement status
POST /visionmax/image/{image_id}/enhance   Apply enhancement with params
POST /visionmax/batch/{batch_id}/enhance   Apply enhancement to all images in batch
POST /visionmax/image/{image_id}/undo      Restore from enhanced_backup (undo last edit)
POST /visionmax/image/{image_id}/revert    Restore from original (full revert)
POST /visionmax/image/{image_id}/skip      Mark as skipped (proceed without enhancement)
POST /visionmax/batch/{batch_id}/complete  Mark batch VisionMax stage as done
GET  /visionmax/image/{image_id}/preview   Get enhanced image preview
```

### Enhancement Parameters (Request Body)

```json
{
  "brightness": 1.0,         // 0.5 – 2.0  (default 1.0)
  "contrast": 1.0,           // 0.5 – 2.0
  "sharpness": 1.0,          // 0.0 – 2.0
  "auto_level": false,       // histogram equalization
  "denoise": false,          // Gaussian blur denoise
  "deskew": false,           // auto deskew rotation correction
  "grayscale": false,        // convert to grayscale
  "binarize": false,         // Otsu thresholding
  "gamma": 1.0               // 0.5 – 2.2 gamma correction
}
```

### File Flow

```
original/image.jpg        ← Never touched
    │
    ▼  (first enhancement)
enhanced_backup/          ← Copy of original before first edit
enhanced/image.jpg        ← Current working version

    │  (subsequent edits)
    ▼
enhanced_backup/          ← Copy of current enhanced (overwritten each edit)
enhanced/image.jpg        ← New version applied
```

- **Undo** = restore `enhanced/` from `enhanced_backup/`
- **Revert to Original** = restore `enhanced/` from `original/`, clear `enhanced_backup`
- DB: `images.enhanced_path`, `images.enhanced_backup_path`, `images.has_enhancement`

### Service — `services/visionmax_service.py`

```python
# Key operations using Pillow + OpenCV
from PIL import Image, ImageEnhance, ImageFilter
import cv2, numpy as np

def apply_enhancement(img_path: str, output_path: str, params: dict):
    img = Image.open(img_path)
    if params.get("brightness") != 1.0:
        img = ImageEnhance.Brightness(img).enhance(params["brightness"])
    if params.get("contrast") != 1.0:
        img = ImageEnhance.Contrast(img).enhance(params["contrast"])
    if params.get("sharpness") != 1.0:
        img = ImageEnhance.Sharpness(img).enhance(params["sharpness"])
    if params.get("grayscale"):
        img = img.convert("L")
    if params.get("auto_level"):
        # OpenCV histogram equalization
        ...
    if params.get("deskew"):
        # Hough transform deskew
        ...
    img.save(output_path)
```

### Frontend — `pages/VisionMax.jsx`

**Layout:**
- Left panel: thumbnail filmstrip of all images in batch (with status chip)
- Center: large image preview with zoom (react-zoom-pan-pinch)
- Right panel: Enhancement controls (sliders + toggles)
- Bottom toolbar: Skip | Apply | Undo | Revert to Original | Next Image
- Top-right: "Mark Batch Complete" button to advance stage

**Before/After Slider:** `BeforeAfterSlider.jsx` — split-view comparison using CSS clip

**Bulk operations:**
- "Apply to All" button applies current settings to entire batch
- Progress modal shows per-image status

---

## 10. Stage 2 — TextIQ (OCR)

### Purpose
Run OCR on each image using OpenAI's vision capability, store the extracted text, allow user to edit text side-by-side with the image, with ability to revert to original OCR output.

### Backend — `routers/textiq.py`

```
GET  /textiq/batch/{batch_id}              List images with OCR status
POST /textiq/image/{image_id}/run          Run OCR (calls OpenAI)
POST /textiq/batch/{batch_id}/run          Run OCR on all images (sequential)
GET  /textiq/image/{image_id}/text         Get current + original text
PUT  /textiq/image/{image_id}/text         Save edited text (updates current_text)
POST /textiq/image/{image_id}/revert       Revert current_text to original_text
POST /textiq/batch/{batch_id}/complete     Mark TextIQ stage done
```

### OCR Service — `services/textiq_service.py`

```python
from openai import AsyncOpenAI
import base64

async def run_ocr(image_path: str, api_key: str) -> str:
    client = AsyncOpenAI(api_key=api_key)
    
    with open(image_path, "rb") as f:
        image_data = base64.b64encode(f.read()).decode()
    
    ext = image_path.split(".")[-1].lower()
    media_type = "image/jpeg" if ext in ["jpg","jpeg"] else f"image/{ext}"
    
    response = await client.chat.completions.create(
        model="gpt-4o",
        messages=[{
            "role": "user",
            "content": [
                {
                    "type": "image_url",
                    "image_url": {
                        "url": f"data:{media_type};base64,{image_data}",
                        "detail": "high"
                    }
                },
                {
                    "type": "text",
                    "text": (
                        "You are a professional genealogical document transcription specialist. "
                        "Transcribe ALL text visible in this historical document image exactly as written. "
                        "Preserve original spelling, punctuation, line breaks, and formatting. "
                        "Use [illegible] for text you cannot read. "
                        "Return ONLY the transcription text, no commentary."
                    )
                }
            ]
        }],
        max_tokens=4000
    )
    return response.choices[0].message.content
```

### Text File Flow

```
text/original/{image_id}.txt   ← Written once on first OCR, never overwritten
text/current/{image_id}.txt    ← Updated on each user save
```

- **Revert** = copy `original/` back to `current/`, set `has_edits = False`
- DB: `ocr_texts.current_text`, `ocr_texts.original_text`, `ocr_texts.has_edits`

### Frontend — `pages/TextIQ.jsx`

**Layout (split view):**
```
┌─────────────────────┬──────────────────────────┐
│                     │  OCR Text Editor          │
│   Image Viewer      │  ┌──────────────────────┐ │
│  (zoomable)         │  │  Editable textarea   │ │
│                     │  │  (monospace font)    │ │
│                     │  └──────────────────────┘ │
│                     │  [Revert] [Save] [Next]   │
└─────────────────────┴──────────────────────────┘
```

- Top bar: image filename, OCR status badge (Pending / Running / Done / Edited)
- Left sidebar: thumbnail list (click to navigate)
- Textarea is **read-only** until user clicks "Edit Text"
- Unsaved changes indicator (dirty state)
- "Run OCR" button triggers API call with loading spinner overlay
- "Run All OCR" button in batch toolbar runs for all un-processed images
- "Revert to Original OCR" — shown only if `has_edits = true`

---

## 11. Stage 3 — IndexGenius (Record Extraction)

### Purpose
Extract structured genealogical data from OCR text using LangChain + OpenAI. Each image may contain one or more records. Extracted data is shown in editable table alongside the image.

### Extracted Fields Per Record

```
record_number       — e.g. "147", "Entry 23"
event_type          — birth | death | marriage | baptism | burial | census | other
given_name          — First/given name of the primary person
surname             — Family name
date_of_birth       — ISO-ish date or partial: "1892", "March 1892", "12 Mar 1892"
date_of_death       — same format
date_of_event       — event date (marriage date, burial date, etc.)
father_name         — Father's full name
mother_name         — Mother's full name (including maiden name if present)
family_members      — Array: [{ name, relation }]
                      relation must be: spouse | child | sibling | grandparent |
                      grandchild | uncle | aunt | nephew | niece | in-law
additional_info     — Place, witnesses, occupation, notes
```

> **Exclusion rule**: `family_members` only includes blood relatives and legal family (spouse). Friends, neighbors, witnesses, godparents are excluded.

### Backend — `routers/indexgenius.py`

```
GET  /indexgenius/batch/{batch_id}             List images with extraction status
POST /indexgenius/image/{image_id}/extract     Run extraction on image's OCR text
POST /indexgenius/batch/{batch_id}/extract     Extract all in batch
GET  /indexgenius/image/{image_id}/records     Get all records for image
PUT  /indexgenius/record/{record_id}           Update a record
DELETE /indexgenius/record/{record_id}         Delete a record
POST /indexgenius/image/{image_id}/records     Add manual record
POST /indexgenius/batch/{batch_id}/complete    Mark IndexGenius stage done
```

### Extraction Service — `services/indexgenius_service.py`

```python
from langchain_openai import ChatOpenAI
from langchain.output_parsers import PydanticOutputParser
from langchain.prompts import ChatPromptTemplate
from pydantic import BaseModel
from typing import Optional, List

class FamilyMember(BaseModel):
    name: str
    relation: str  # spouse|child|sibling|grandparent|grandchild|uncle|aunt|nephew|niece|in-law

class GenealogyRecord(BaseModel):
    record_number: Optional[str]
    event_type: str
    given_name: Optional[str]
    surname: Optional[str]
    date_of_birth: Optional[str]
    date_of_death: Optional[str]
    date_of_event: Optional[str]
    father_name: Optional[str]
    mother_name: Optional[str]
    family_members: List[FamilyMember] = []
    additional_info: Optional[str]

class ExtractionResult(BaseModel):
    records: List[GenealogyRecord]

async def extract_records(ocr_text: str, api_key: str) -> ExtractionResult:
    llm = ChatOpenAI(model="gpt-4o", api_key=api_key, temperature=0)
    parser = PydanticOutputParser(pydantic_object=ExtractionResult)
    
    prompt = ChatPromptTemplate.from_messages([
        ("system", """You are an expert genealogical record indexer. 
Extract all individual records from the provided OCR text of a historical document.
For each person/record found, extract the specified fields.
IMPORTANT: In family_members, only include direct blood relatives and spouses.
DO NOT include: friends, neighbors, witnesses, godparents, employers, or anyone 
without a direct family relationship to the primary person.
{format_instructions}"""),
        ("human", "OCR Text:\n\n{text}")
    ]).partial(format_instructions=parser.get_format_instructions())
    
    chain = prompt | llm | parser
    return await chain.ainvoke({"text": ocr_text})
```

### Frontend — `pages/IndexGenius.jsx`

**Layout:**
```
┌─────────────────────┬───────────────────────────────────┐
│                     │  Extracted Records                 │
│   OCR Text          │  ┌─────────────────────────────┐  │
│   (read-only        │  │ Record #1  [Edit] [Delete]  │  │
│    reference)       │  │ ┌─────┬──────────────────┐  │  │
│                     │  │ │Field│ Value            │  │  │
│                     │  │ ├─────┼──────────────────┤  │  │
│                     │  │ │ ... │ ...              │  │  │
│                     │  │ └─────┴──────────────────┘  │  │
│                     │  │ Family Members:             │  │
│                     │  │ [Name] – [Relation]        │  │
│                     │  └─────────────────────────────┘  │
│                     │  [+ Add Record] [Save All]        │
└─────────────────────┴───────────────────────────────────┘
```

- **RecordTable** renders fields in a two-column key-value table
- Inline editing on each field (click field value → text input)
- Family members rendered as chips with name + relation badge
- "Extract Records" button triggers AI extraction
- Edited indicator badge on records with unsaved changes

---

## 12. Stage 4 — GedcomX Generator

### Purpose
Convert each extracted record into a valid [GedcomX JSON](http://www.gedcomx.org/Specifications.html) structure representing the person and their relationships. One GedcomX file per record.

### GedcomX Structure Generated

```json
{
  "id": "ged-{record_id}",
  "description": "#mainPerson",
  "persons": [
    {
      "id": "p1",
      "extracted": true,
      "names": [{ "nameForms": [{ "fullText": "John Smith" }] }],
      "facts": [
        { "type": "http://gedcomx.org/Birth", "date": { "original": "12 Mar 1892" } },
        { "type": "http://gedcomx.org/Death", "date": { "original": "5 Jan 1950" } }
      ]
    },
    {
      "id": "p2",
      "names": [{ "nameForms": [{ "fullText": "William Smith" }] }]
    }
    // ... father, mother, family members
  ],
  "relationships": [
    {
      "type": "http://gedcomx.org/ParentChild",
      "person1": { "resource": "#p2" },
      "person2": { "resource": "#p1" }
    }
  ],
  "sourceDescriptions": [
    {
      "id": "s1",
      "titles": [{ "value": "Source Image" }]
    }
  ]
}
```

### Backend — `routers/gedcomx.py`

```
POST /gedcomx/record/{record_id}/generate   Generate GedcomX from record
POST /gedcomx/batch/{batch_id}/generate     Generate for all complete records in batch
GET  /gedcomx/record/{record_id}            Get GedcomX for a record
PUT  /gedcomx/record/{record_id}            Update GedcomX JSON
GET  /gedcomx/batch/{batch_id}/export       Export all GedcomX as ZIP
```

### Service — `services/gedcomx_service.py`

```python
from langchain_openai import ChatOpenAI
from langchain.prompts import ChatPromptTemplate
import json, uuid

GEDCOMX_SYSTEM_PROMPT = """
You are a genealogical data expert specializing in the GedcomX JSON format.
Convert the provided structured genealogy record into a valid GedcomX JSON document.
Follow the GedcomX specification strictly:
- Use proper URIs for relationship types (http://gedcomx.org/ParentChild, http://gedcomx.org/Couple)
- Include all persons mentioned in the record
- Create appropriate relationships
- Use fact types: http://gedcomx.org/Birth, http://gedcomx.org/Death, etc.
Return ONLY valid JSON. No markdown, no explanation.
"""

async def generate_gedcomx(record: dict, api_key: str) -> dict:
    llm = ChatOpenAI(model="gpt-4o", api_key=api_key, temperature=0)
    
    prompt = ChatPromptTemplate.from_messages([
        ("system", GEDCOMX_SYSTEM_PROMPT),
        ("human", "Record data:\n{record_json}\n\nGenerate GedcomX JSON:")
    ])
    
    chain = prompt | llm
    result = await chain.ainvoke({"record_json": json.dumps(record, indent=2)})
    
    raw = result.content.strip()
    # Strip markdown fences if present
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    
    return json.loads(raw.strip())
```

### Frontend — `pages/GedcomXView.jsx`

- Shows list of records with GedcomX generation status
- "Generate" button per record or "Generate All"
- Raw JSON viewer (collapsible) for inspection
- "Proceed to Tree Viewer" button when all records are generated

---

## 13. Stage 5 — Tree Viewer

### Purpose
Visual, navigatable family tree for each record's GedcomX data. User can browse record by record through the batch.

### Backend — `routers/treeviewer.py`

```
GET /treeviewer/batch/{batch_id}/records    List all records with gedcomx status
GET /treeviewer/record/{record_id}/tree     Get tree data (transformed for frontend)
```

**Tree data transformation** — converts GedcomX into a D3-friendly tree node structure:
```json
{
  "id": "p1",
  "name": "John Smith",
  "gender": "male",
  "birth": "12 Mar 1892",
  "death": "5 Jan 1950",
  "children": [...],
  "spouse": {...},
  "parents": [...]
}
```

### Frontend — `pages/TreeViewer.jsx`

**Layout:**
```
┌──────────────────────────────────────────────────────────┐
│  ◀ Record 3 of 24 ▶        [Batch: Parish Records 1892]  │
├──────────────────────────────────────────────────────────┤
│                                                           │
│    [Grandfather]    [Grandmother]                         │
│          └────────┬────────┘                             │
│               [Father]    [Mother]                        │
│                    └────────┬──┘                         │
│                         [★ JOHN SMITH]                   │
│                        Birth: 12 Mar 1892                 │
│                              │                            │
│                     ┌────────┴────────┐                  │
│                  [Child 1]        [Child 2]               │
│                                                           │
├──────────────────────────────────────────────────────────┤
│  Source Image: [thumbnail]  OCR Text: [collapse toggle]  │
└──────────────────────────────────────────────────────────┘
```

**Features:**
- Record navigation: Previous / Next arrows, record counter
- Zoom/pan on tree canvas (react-d3-tree or custom SVG + D3)
- Click on any node → side panel shows person details
- Person nodes colored by: primary (gold), parent (blue), child (green), spouse (pink)
- Bottom panel: source image thumbnail + OCR text reference (collapsible)
- Export as PNG button

---

## 14. Backend API Reference

### Complete Route Map

| Method | Path | Description |
|--------|------|-------------|
| POST | `/auth/register` | Register new user |
| POST | `/auth/login` | Login, get JWT |
| GET | `/auth/me` | Current user info |
| GET | `/projects/` | List projects |
| POST | `/projects/` | Create project |
| GET | `/projects/{id}` | Project detail |
| PUT | `/projects/{id}` | Update project |
| DELETE | `/projects/{id}` | Delete project |
| GET | `/batches/?project_id=` | List batches |
| POST | `/batches/` | Create batch |
| GET | `/batches/{id}` | Batch detail |
| PUT | `/batches/{id}` | Update batch |
| DELETE | `/batches/{id}` | Delete batch |
| POST | `/batches/{id}/upload` | Upload images |
| GET | `/visionmax/batch/{id}` | Batch image list |
| POST | `/visionmax/image/{id}/enhance` | Enhance image |
| POST | `/visionmax/image/{id}/undo` | Undo last enhancement |
| POST | `/visionmax/image/{id}/revert` | Revert to original |
| POST | `/visionmax/image/{id}/skip` | Skip image |
| POST | `/visionmax/batch/{id}/complete` | Complete VisionMax stage |
| POST | `/textiq/image/{id}/run` | Run OCR |
| POST | `/textiq/batch/{id}/run` | Run OCR on batch |
| GET | `/textiq/image/{id}/text` | Get text |
| PUT | `/textiq/image/{id}/text` | Save edited text |
| POST | `/textiq/image/{id}/revert` | Revert text to original |
| POST | `/textiq/batch/{id}/complete` | Complete TextIQ stage |
| POST | `/indexgenius/image/{id}/extract` | Extract records |
| POST | `/indexgenius/batch/{id}/extract` | Extract all in batch |
| GET | `/indexgenius/image/{id}/records` | Get records |
| PUT | `/indexgenius/record/{id}` | Update record |
| DELETE | `/indexgenius/record/{id}` | Delete record |
| POST | `/indexgenius/batch/{id}/complete` | Complete IndexGenius stage |
| POST | `/gedcomx/record/{id}/generate` | Generate GedcomX |
| GET | `/gedcomx/record/{id}` | Get GedcomX |
| GET | `/gedcomx/batch/{id}/export` | Export ZIP |
| GET | `/treeviewer/batch/{id}/records` | Tree records list |
| GET | `/treeviewer/record/{id}/tree` | Tree data |

---

## 15. Frontend Pages & Components

### Route Map

```
/                    → redirect to /dashboard (if logged in) or /login
/login               → Login.jsx
/register            → Register.jsx
/dashboard           → Dashboard.jsx  (project list)
/projects/:id        → ProjectDetail.jsx  (batch list)
/batches/:id         → BatchDetail.jsx  (image list + stage overview)
/batches/:id/visionmax        → VisionMax.jsx
/batches/:id/textiq           → TextIQ.jsx
/batches/:id/indexgenius      → IndexGenius.jsx
/batches/:id/gedcomx          → GedcomXView.jsx
/batches/:id/treeviewer       → TreeViewer.jsx
```

### StageProgress Component

Persistent progress bar shown on all stage pages:
```
[Upload] ──▶ [VisionMax] ──▶ [TextIQ] ──▶ [IndexGenius] ──▶ [GedcomX] ──▶ [Tree]
  ✓              ✓              ●              ○                ○              ○
```
- ✓ = complete, ● = current, ○ = upcoming
- Each stage is a clickable link to navigate to that stage

### Sidebar Navigation
- GenealogIQ logo + tagline
- Current user name + avatar (initials)
- Active project/batch breadcrumb
- Logout button

---

## 16. File Storage Strategy

### Path Convention
```
BASE = ./storage/users/{user_id}/projects/{project_id}/batches/{batch_id}/
```

| File Type | Path | Notes |
|-----------|------|-------|
| Original image | `images/original/{uuid}_filename.jpg` | Written once, read-only |
| Enhanced image | `images/enhanced/{uuid}_filename.jpg` | Current working version |
| Pre-edit backup | `images/enhanced_backup/{uuid}_filename.jpg` | One undo level |
| Original OCR text | `text/original/{image_id}.txt` | Written once |
| Current text | `text/current/{image_id}.txt` | User-editable copy |
| GedcomX | `gedcomx/{record_id}.json` | Per-record GedcomX |

### FileService — `services/file_service.py`

```python
from pathlib import Path
import shutil, uuid

class FileService:
    BASE = Path("./storage")
    
    def user_path(self, user_id: int) -> Path:
        return self.BASE / "users" / str(user_id)
    
    def batch_path(self, user_id, project_id, batch_id) -> Path:
        return self.user_path(user_id) / "projects" / str(project_id) / "batches" / str(batch_id)
    
    def save_original(self, user_id, project_id, batch_id, file_bytes, filename) -> str:
        path = self.batch_path(user_id, project_id, batch_id) / "images" / "original"
        path.mkdir(parents=True, exist_ok=True)
        safe_name = f"{uuid.uuid4().hex}_{filename}"
        (path / safe_name).write_bytes(file_bytes)
        return str(path / safe_name)
    
    def backup_enhanced(self, enhanced_path: str) -> str:
        backup_path = enhanced_path.replace("/enhanced/", "/enhanced_backup/")
        Path(backup_path).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(enhanced_path, backup_path)
        return backup_path
    
    def delete_batch_files(self, user_id, project_id, batch_id):
        shutil.rmtree(self.batch_path(user_id, project_id, batch_id), ignore_errors=True)
```

---

## 17. OpenAI Integration

### Configuration

```python
# config.py
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    openai_api_key: str
    jwt_secret: str
    database_url: str = "sqlite+aiosqlite:///./genealogiq.db"
    
    class Config:
        env_file = ".env"

settings = Settings()
```

### OpenAI Service — `services/openai_service.py`

```python
from openai import AsyncOpenAI

_client: AsyncOpenAI | None = None

def get_openai_client(api_key: str) -> AsyncOpenAI:
    return AsyncOpenAI(api_key=api_key)
```

### Models Used

| Stage | Model | Purpose |
|-------|-------|---------|
| TextIQ OCR | `gpt-4o` | Vision + high-quality transcription |
| IndexGenius | `gpt-4o` | Structured JSON extraction via LangChain |
| GedcomX | `gpt-4o` | GedcomX JSON generation |
| Tree Data | n/a | Computed from GedcomX, no LLM needed |

---

## 18. LangChain Integration

### Installation
```
langchain>=0.3.0
langchain-openai>=0.2.0
```

### Usage in IndexGenius

```python
from langchain_openai import ChatOpenAI
from langchain_core.output_parsers import PydanticOutputParser
from langchain_core.prompts import ChatPromptTemplate

# Pydantic models for type-safe extraction
# Chain: prompt | llm | parser
# Handles retry on parse failure automatically
```

### Usage in GedcomX

```python
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate

# JSON-mode output via ChatOpenAI
# Post-process to strip markdown fences
# Validate against GedcomX schema
```

---

## 19. Environment & Configuration

### `.env` File

```env
OPENAI_API_KEY=sk-...
JWT_SECRET=your-super-secret-jwt-key-change-this
DATABASE_URL=sqlite+aiosqlite:///./genealogiq.db
STORAGE_BASE=./storage
ALLOWED_ORIGINS=http://localhost:5173
```

### `backend/requirements.txt`

```
fastapi>=0.111.0
uvicorn[standard]>=0.30.0
sqlalchemy[asyncio]>=2.0.0
aiosqlite>=0.20.0
python-jose[cryptography]>=3.3.0
passlib[bcrypt]>=1.7.4
python-multipart>=0.0.9
pillow>=10.0.0
opencv-python-headless>=4.9.0
pydantic>=2.0.0
pydantic-settings>=2.0.0
openai>=1.30.0
langchain>=0.3.0
langchain-openai>=0.2.0
python-dotenv>=1.0.0
aiofiles>=23.0.0
```

### `frontend/package.json` (key deps)

```json
{
  "dependencies": {
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "react-router-dom": "^6.23.0",
    "axios": "^1.7.0",
    "zustand": "^4.5.0",
    "@tanstack/react-query": "^5.40.0",
    "react-zoom-pan-pinch": "^3.4.0",
    "react-d3-tree": "^3.6.0",
    "tailwindcss": "^3.4.0",
    "@radix-ui/react-dialog": "^1.1.0",
    "@radix-ui/react-toast": "^1.2.0",
    "lucide-react": "^0.383.0"
  }
}
```

---

## 20. Setup & Run Instructions

### Backend Setup

```bash
cd backend
python -m venv venv
source venv/bin/activate    # Windows: venv\Scripts\activate
pip install -r requirements.txt

# Copy and fill in .env
cp ../.env.example ../.env

# Run
uvicorn main:app --reload --port 8000
```

### Frontend Setup

```bash
cd frontend
npm install
npm run dev       # starts on http://localhost:5173
```

### First Run

1. Open `http://localhost:5173/register`
2. Create an account
3. Create a project
4. Create a batch inside the project
5. Upload images
6. Process through each stage

---

## 21. MVP Build Sequence

Build in this order to have a working, testable system at each step:

### Phase 1 — Foundation (Days 1–2)
- [ ] FastAPI app skeleton + CORS + health endpoint
- [ ] SQLite DB setup with SQLAlchemy async
- [ ] All DB models + Alembic migrations (or create_all)
- [ ] Auth: register, login, JWT, `get_current_user`
- [ ] React app with Vite + Tailwind + routing scaffold
- [ ] Login / Register pages + Axios interceptor + authStore

### Phase 2 — Projects & Batches (Days 3–4)
- [ ] Projects CRUD backend + frontend (Dashboard, ProjectDetail)
- [ ] Batches CRUD backend + frontend (BatchDetail)
- [ ] Image upload endpoint + FileService
- [ ] ImageGrid frontend component
- [ ] Delete cascade (project → batches → images → files)

### Phase 3 — VisionMax (Days 5–6)
- [ ] VisionMax backend endpoints
- [ ] Pillow/OpenCV enhancement service
- [ ] File flow: original → enhanced → backup
- [ ] Undo / Revert logic
- [ ] VisionMax frontend page (controls + before/after)

### Phase 4 — TextIQ (Days 7–8)
- [ ] OpenAI vision OCR service
- [ ] Text storage + revert logic
- [ ] TextIQ backend endpoints
- [ ] Side-by-side frontend (image + editable textarea)

### Phase 5 — IndexGenius (Days 9–10)
- [ ] LangChain extraction chain + Pydantic models
- [ ] IndexGenius backend endpoints
- [ ] Records CRUD
- [ ] Frontend: side-by-side text + editable record tables

### Phase 6 — GedcomX (Days 11–12)
- [ ] GedcomX generation service (LangChain + GPT-4o)
- [ ] GedcomX backend endpoints
- [ ] Frontend: generation UI + JSON viewer
- [ ] ZIP export endpoint

### Phase 7 — Tree Viewer (Days 13–14)
- [ ] GedcomX → D3 tree data transformer
- [ ] TreeViewer backend endpoint
- [ ] Frontend: react-d3-tree integration
- [ ] Record navigation (prev/next)
- [ ] Node detail side panel

### Phase 8 — Polish (Days 15–16)
- [ ] StageProgress component across all pages
- [ ] Error boundaries + toast notifications
- [ ] Loading states + skeleton screens
- [ ] Batch/project edit + delete confirmations
- [ ] Mobile responsive layout tweaks
- [ ] OpenAI API key input in user settings (stored in .env or user profile)

---

## Appendix: Key Design Decisions

### Non-Destructive Editing
Every edit creates a backup. Original files are sacred. This guarantees data integrity even if AI processing produces poor results.

### Per-Image Stage Status
Each image tracks its own `visionmax_status`, `textiq_status`, etc. This allows partial processing — if OCR fails on one image, others can continue.

### Stage Flexibility
No stage is mandatory. Users can skip VisionMax entirely, or skip indexing for specific images. The pipeline is advisory, not blocking.

### LangChain over Raw OpenAI
LangChain is used for structured extraction (IndexGenius + GedcomX) to get type-safe Pydantic outputs with automatic retry on parse failures. Raw OpenAI SDK is used for OCR (TextIQ) where we need raw text with no schema.

### Single SQLite for MVP
Simplifies deployment — no separate DB server needed. Sufficient for MVP with hundreds of images. Can be migrated to PostgreSQL for production.

### GedcomX JSON over GEDCOM 5.5
GedcomX JSON is the modern, machine-readable successor to GEDCOM. It's easier to generate with LLMs and parse in the frontend. Export as traditional GEDCOM can be added post-MVP.