---
name: Vibrant Pulse Fintech
colors:
  surface: '#f6faff'
  surface-dim: '#d2dbe4'
  surface-bright: '#f6faff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#ecf5fe'
  surface-container: '#e6eff8'
  surface-container-high: '#e0e9f2'
  surface-container-highest: '#dbe4ed'
  on-surface: '#141d23'
  on-surface-variant: '#3c4b38'
  inverse-surface: '#293138'
  inverse-on-surface: '#e9f2fb'
  outline: '#6c7b67'
  outline-variant: '#bbcbb3'
  surface-tint: '#006e14'
  primary: '#006e14'
  on-primary: '#ffffff'
  primary-container: '#00d632'
  on-primary-container: '#00560e'
  inverse-primary: '#2ae540'
  secondary: '#5c5f62'
  on-secondary: '#ffffff'
  secondary-container: '#e1e2e7'
  on-secondary-container: '#626468'
  tertiary: '#865300'
  on-tertiary: '#ffffff'
  tertiary-container: '#fea51f'
  on-tertiary-container: '#694000'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#73ff6f'
  primary-fixed-dim: '#2ae540'
  on-primary-fixed: '#002202'
  on-primary-fixed-variant: '#00530d'
  secondary-fixed: '#e1e2e7'
  secondary-fixed-dim: '#c5c6cb'
  on-secondary-fixed: '#191c1f'
  on-secondary-fixed-variant: '#44474b'
  tertiary-fixed: '#ffddb9'
  tertiary-fixed-dim: '#ffb961'
  on-tertiary-fixed: '#2b1700'
  on-tertiary-fixed-variant: '#663e00'
  background: '#f6faff'
  on-background: '#141d23'
  surface-variant: '#dbe4ed'
typography:
  display-hero:
    fontFamily: Plus Jakarta Sans
    fontSize: 56px
    fontWeight: '800'
    lineHeight: 64px
  display-hero-mobile:
    fontFamily: Plus Jakarta Sans
    fontSize: 44px
    fontWeight: '800'
    lineHeight: 52px
  headline-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
  headline-lg-mobile:
    fontFamily: Plus Jakarta Sans
    fontSize: 26px
    fontWeight: '700'
    lineHeight: 34px
  headline-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 22px
    fontWeight: '700'
    lineHeight: 28px
  headline-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 24px
  body-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 16px
    fontWeight: '500'
    lineHeight: 24px
  body-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  label-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 14px
    fontWeight: '700'
    lineHeight: 18px
  label-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
  label-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 10px
    fontWeight: '700'
    lineHeight: 14px
rounded:
  sm: 0.5rem
  DEFAULT: 1rem
  md: 1.5rem
  lg: 2rem
  xl: 3rem
  full: 9999px
spacing:
  gutter: 1rem
  gutter-mobile: 0.75rem
  margin: 1.5rem
  margin-mobile: 1rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.5rem
  space-xl: 2rem
---

## Brand & Style

This design system blends the high-energy, electric punch of modern peer-to-peer payment utilities with the crisp, utility-first clarity of mobile commerce interfaces. It balances radical minimalism with tactile punchiness: stark contrasts, punchy typographic hierarchy, and confident spatial separation create an interface that feels instantaneous, safe, and fluid.

### Key Personality Drivers
- **Electrifying Confidence:** Bold, punchy mint-green accents set against deep obsidian foundations communicate speed, momentum, and modern digital wealth.
- **Unwavering Clarity:** Transactions and critical account details are devoid of cognitive clutter. Every Rupee value (`₹`), state badge, and call-to-action commands immediate comprehension.
- **Modern Tactility:** Drawing from hyper-rounded mobile sheet interactions, cards and interaction surfaces feature generous edge curves, pill buttons, and subtle structural hairline borders instead of muddy drop shadows.

### Design Movement
- **High-Contrast Modernism with Tactile Utility:** High color contrast paired with ultra-clean white surfaces, crisp dark mode inversions, deep obsidian anchor buttons, and generous `rounded-2xl` to `rounded-3xl` cards.

## Colors

The palette leverages a signature high-energy emerald/mint green (`#00D632`) as the hero primary, balanced by deep obsidian black (`#0B0E11`) for maximum contrast and authority. Pure surfaces (`#FFFFFF` and `#F8F9FA`) host crisp hairline borders and bold typography.

### Palette Architecture
- **Primary (`#00D632`):** Used for primary success indicators, confirmed transfer surfaces, key actionable badges, and the signature transfer pad canvas.
- **Secondary / Anchor (`#0B0E11`):** Deep obsidian black used for high-emphasis typography, prominent bottom sheet action triggers, keypad numbers, and primary button fills.
- **Tertiary / Warning (`#F39C12`):** Amber tone dedicated strictly to the "Pending" transaction status, escrow holds, and cautionary verification alerts.
- **Neutral (`#6C757D`):** Balanced slate neutral for secondary labels, timestamps, transaction metadata, and inactive icons.
- **Card & Sheet Surfaces:** Pure white (`#FFFFFF`) layered on top of off-white canvasing (`#F5F6F8`), bound with delicate borders (`#E9ECEF`).

### Transaction State Matrix
- **Approved / Settled:** Mint Green text and icon (`#00A827`) set on a light mint tint background (`#E6F9EC`).
- **Pending / Processing:** Warm Amber text and clock icon (`#B7791F`) set on a warm cream tint background (`#FEF3C7`).
- **Failed / Cancelled:** Coral Red text (`#DC2626`) set on a soft red wash (`#FEE2E2`).

## Typography

The design system relies entirely on **Plus Jakarta Sans** across all roles to achieve a friendly, contemporary, yet razor-sharp modern fintech delivery. Its geometric structures and balanced aperture ensure absolute legibility of large financial numbers, Rupee (`₹`) symbols, and rapid keypads.

### Typographic Rules & Rupee (`₹`) Formatting
- **Currency Presentation:** The Rupee symbol (`₹`) is rendered alongside numeric amounts with zero whitespace separation (e.g., `₹500`, `₹1,24,500.00`).
- **Hero Keypads & Transfer Displays:** On dynamic payment keypads, numbers use `display-hero-mobile` or `display-hero` with an 800 weight for immediate tactile feedback.
- **Negative and Positive Flow:** Outgoing payments omit signs or use a neutral minus (`-₹500`), while incoming credits use bold positive green notation (`+₹1,200`).
- **Pacing & Scannability:** Subtext and transaction counterpart metadata (`@cashtag`, VPA handles, or timestamps) must maintain a minimum weight of 500 to preserve contrast under mobile daylight conditions.

## Layout & Spacing

The layout philosophy prioritizes mobile-first usability through a safe-area-conscious fluid column architecture. Content aligns to a 4-column grid on mobile hand-held viewports and expands into an 8-column layout on compact tablets or multi-window modes.

### Structural Rhythm
- **Mobile Edge Margins:** Screen margins default to `1rem` (16px) on compact handheld devices to maximize tap targets and card widths, scaling to `1.5rem` on larger displays.
- **Touch-First Thumb Zones:** Critical action triggers (such as "Pay", "Request", and numeric dial pads) are anchored strictly within the lower 40% of the screen.
- **Card-to-Card Stacking:** Feed items, merchant cards, and transaction records use a consistent `space-sm` (8px) or `space-md` (16px) vertical gap to avoid visual crowding.
- **Content Bottom Cleats:** All scrollable viewports must enforce a minimum bottom clearance of `5.5rem` to guarantee accessibility above floating bars and iOS/Android home indicators.

## Elevation & Depth

Visual hierarchy is maintained primarily through **low-contrast outlines, tactile sheet docking, and surface tiering** rather than heavy drop shadows. This preserves crispness in both high-light outdoor environments and low-light financial settings.

### Depth Hierarchy
- **Level 0 (Base Canvas):** Background color `#F8F9FA` (or solid `#00D632` during instant send flows). Completely flat with zero elevation.
- **Level 1 (Cards & Feed Panels):** Pure white `#FFFFFF` surface paired with a fine 1px hairline border (`#E9ECEF`). No box-shadow. This creates crisp separation without visual murkiness.
- **Level 2 (Interactive Floating Elements & Modals):** High-priority overlays (such as bottom sheets, QR scanners, and confirmation trays) feature a 24px top-corner radius (`rounded-3xl`) and an ambient, ultra-diffused atmospheric lift:
  - `box-shadow: 0 12px 32px -4px rgba(11, 14, 17, 0.08), 0 4px 12px -2px rgba(11, 14, 17, 0.04)`
- **Level 3 (Sticky CTAs & Floating Action Badges):** Bottom pinned action trays use a glassmorphic blur with soft border separation:
  - `background: rgba(255, 255, 255, 0.92); backdrop-filter: blur(16px); border-top: 1px solid rgba(233, 236, 239, 0.8)`

## Shapes

The shape vocabulary is friendly, modern, and distinctively rounded. All action triggers, input caps, and card enclosures draw heavily from rounded pill geometries and oversized corner radii.

### Shape Tiers
- **Pill Geometry (Fully Rounded / 9999px):** Primary CTAs, secondary action chips, status pills, category selectors, and avatar frames.
- **Card & Surface Enclosures (`rounded-2xl` to `rounded-3xl` / 16px to 24px):** Bank account summary cards, merchant transaction groupings, and modal bottom sheets.
- **Inputs & Keypad Targets (`rounded-2xl` / 16px):** Form fields, search bars, and quick-amount selectors.

## Components

### Buttons
- **Primary Action (Pill):** Solid obsidian `#0B0E11` background, white label, full width on mobile screens, height of 56px with a pill shape (`border-radius: 9999px`). When rendered on dark surfaces or primary brand canvas, inverted to pure white background with obsidian text.
- **Secondary Brand Action:** Vibrant mint `#00D632` background with `#0B0E11` text for high-importance actions like "Pay" or "Claim Cashback".
- **Ghost / Tonal Pill:** Light gray fill (`#F1F3F5`) with `#0B0E11` text, 44px height, used for secondary actions like "Split Bill", "Request", or "Add Note".

### Chips & Filters
- Compact 36px pill containers. Inactive state: white background with `#E9ECEF` border and `#6C757D` label. Active state: `#0B0E11` fill with crisp white text. Can support small leading icons (e.g., filter, quick amount `₹500`, `₹1,000`).

### Transaction List Items
- Clean single or double line items with 48px rounded avatar/icon badges on the left.
- **Title:** Counterpart name or merchant (`headline-sm`, 16px bold).
- **Subtitle:** Timestamp and settlement channel (`body-md`, neutral `#6C757D`).
- **Amount & Status:** Right-aligned Rupee amount. Directly beneath the value sits an explicit state badge:
  - **Pending:** Amber chip (`#FEF3C7` background, `#B7791F` text) reading `Pending • ₹1,450`.
  - **Approved:** Minimal green check indicator or green text reading `Approved • ₹1,450`.

### Input Fields & Keypads
- **Search & Contact Inputs:** 48px height, rounded pill shape, `#F1F3F5` subtle fill, no outline until active. On focus, transitions to a 1.5px solid `#0B0E11` border.
- **Financial Amount Keypad:** Large numeric layout with zero borders. Tactile tap response with scale feedback on tap down. Numbers centered with 64px vertical clearance between rows.

### Cards
- Pure white `#FFFFFF` background, 20px padding (`space-lg`), 20px to 24px corner radius (`rounded-3xl`), finished with a hairline border (`1px solid #E9ECEF`).
- Contains clear semantic sectioning: top right meta info, centered balance / details, bottom row quick actions.

### Currency Formatting Rules
- Display Rupee format adheres to Indian numbering standards for large denominations when applicable (e.g., `₹1,00,000` instead of `₹100,000`).