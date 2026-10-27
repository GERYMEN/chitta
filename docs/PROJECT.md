# Tracker — React Native Project Plan & Orchestra Workflow

## 1. Project Charter

### Product

**Tracker** is a local-first personal finance application that automatically detects potential **income and expense transactions** from supported SMS, UPI, and payment notifications, places them into a **Pending** queue, and requires explicit user approval before a transaction becomes part of the approved financial record.

### Core principle

> **Detect → Review if needed → Approve → Record**

The application must never treat detection as approval.

### Phase 1 objective

Build a polished Android-first React Native application that:

- tracks approved income and expenses;
- detects potential transactions;
- keeps detected items in a pending queue;
- allows one-tap approval for high-confidence detections;
- allows review/edit/reject for uncertain detections;
- tracks accounts and calculated balances;
- keeps an on-device audit trail;
- provides the designed onboarding/tour and permission experience.

### Explicit scope boundaries

Phase 1 is **not**:

- a banking application;
- a UPI payment initiation application;
- a money-transfer application;
- a bank-login application;
- an investment application;
- a cloud financial-data aggregation platform.

Do not request banking passwords, PINs, CVVs, OTPs, or internet-banking credentials.

---

# 2. Source of Truth

The supplied `DESIGN.md` is the primary written design-system source for visual implementation.

The attached screens are the visual/product-flow reference for:

- Home;
- Pending Transactions;
- Pending Transaction Review;
- Transactions / Ledger;
- Accounts;
- onboarding/tour;
- transaction-detection permission flow.

The current design system defines:

- light fintech surfaces;
- electric green primary/action accents;
- deep obsidian high-emphasis surfaces;
- amber for pending state;
- red/coral for destructive/failed state;
- Plus Jakarta Sans typography;
- rounded cards and pill controls;
- mobile-first spacing;
- hairline borders over heavy shadows.

The design system specifies the primary colors, typography, spacing, shape vocabulary, transaction-state matrix, card rules, and currency formatting. See `DESIGN.md` for exact values.

---

# 3. Product UX Model

## 3.1 Transaction lifecycle

```text
External transaction signal
        |
        v
Detected
        |
        v
Pending Approval
        |
   +----+----+
   |         |
   v         v
Approve    Review
   |         |
   |    +----+----+
   |    |    |    |
   |    v    v    v
   |   Edit Approve Reject
   |         |
   +---------+
        |
        v
Approved Record
        |
        +--> Transactions History
        +--> Account Balance
        +--> Dashboard
        +--> Audit Trail
```

## 3.2 State meanings

### DETECTED

The app found a possible financial transaction from an external source.

It has **not** changed the approved financial record.

### PENDING

The detection has been normalized and classified enough to show to the user.

It still has no effect on approved balances.

### APPROVED

The user explicitly authorized the transaction.

Only this state affects the financial ledger and calculated account balances.

### REJECTED / IGNORED

The user explicitly decided not to record the detection.

It must not affect financial balances.

### FAILED / INVALID

The detector/parser could not safely produce a usable transaction.

The UI should not ask for approval until the data is sufficiently usable.

---

# 4. UX Architecture

## Primary navigation

Use four primary destinations:

```text
Home
Transactions
Pending
Accounts
```

Do not add more bottom-navigation destinations in Phase 1.

## Primary interaction model

Normal case:

```text
Notification
  -> Pending
  -> Approve
  -> Done
```

Exception case:

```text
Pending
  -> Review
  -> Edit if necessary
  -> Approve
```

The product should optimize for the first path.

## Progressive disclosure

Do not put every technical/audit field on every card.

### List level

Show:

- merchant/source;
- amount;
- income/expense;
- time;
- category;
- payment channel/account;
- pending/approved state;
- confidence when useful.

### Review level

Show:

- amount;
- transaction type;
- merchant;
- category;
- account;
- date/time;
- note;
- detected source;
- confidence;
- sanitized source message.

### Advanced/audit level

Keep collapsed unless requested:

- parser version;
- detection timestamp;
- source metadata;
- reference identifiers;
- audit events;
- technical verification information.

---

# 5. Screen Inventory

## 5.1 Home

Purpose:

- total balance;
- monthly income;
- monthly expenses;
- pending approvals;
- recent approved transactions.

Important interaction:

- high-confidence pending items can be approved directly from Home;
- `See all` opens Pending;
- do not duplicate `See all` with a second large review CTA.

## 5.2 Pending

Purpose:

- show all detected but unapproved transactions.

Default card:

```text
Merchant
Amount
Time · channel
Category
Confidence/state

[ Approve ] [ Review ]
```

Do not put Edit and Reject on every card.

Review should open a bottom sheet or equivalent focused review surface.

## 5.3 Transaction Review

One reusable transaction-detail architecture must support both pending and approved states.

### Pending

```text
Pending Approval

Transaction summary
Transaction fields
Detection transparency

[ Approve Transaction ]
[ Edit ]
[ Reject ]
```

### Approved

```text
Approved

Transaction summary
Transaction fields
Detection transparency

[ Edit ]
[ Delete ]
```

## 5.4 Transactions

Purpose:

- approved transaction history only;
- monthly summary;
- search;
- quick filters;
- date grouping;
- transaction detail navigation.

Never mix pending records into the approved history.

## 5.5 Accounts

Purpose:

- bank accounts;
- cash;
- credit cards;
- UPI/payment sources;
- calculated tracked balance.

Balance model:

```text
Opening Balance
+ Approved Income
- Approved Expense
= Calculated Balance
```

Do not imply direct bank control.

## 5.6 Onboarding / Tour

Recommended flow:

```text
Welcome
  -> Dashboard
  -> Automatic Detection
  -> User Approval
  -> Transaction History
  -> Accounts
  -> Permissions
  -> Home
```

Keep the tour short and interactive where possible.

Core message:

> Transactions are detected automatically, but the user controls what becomes a financial record.

---

# 6. Design System Implementation

## Typography

Use **Plus Jakarta Sans** across the application.

Create semantic text tokens rather than scattering raw font sizes:

```text
displayHero
displayHeroMobile
headlineLg
headlineLgMobile
headlineMd
headlineSm
bodyLg
bodyMd
labelLg
labelMd
labelSm
```

The exact design-system values are defined in `DESIGN.md`.

## Color tokens

Create centralized theme tokens.

Primary examples:

```ts
surface
surfaceContainer
surfaceContainerHigh
onSurface
onSurfaceVariant
primary
onPrimary
primaryContainer
secondary
tertiary
error
```

Do not hard-code hex values inside feature components.

## Transaction state tokens

```text
approved
pending
failed
rejected
```

Map visual state to tokens.

Example:

```ts
transactionStateColors.pending
transactionStateColors.approved
```

## Shape tokens

Use centralized radii:

```text
sm
default
md
lg
xl
full
```

## Spacing

Create spacing tokens:

```text
xs
sm
md
lg
xl
screen
```

The mobile default should follow the supplied design system.

## Currency

All financial amounts use INR formatting.

Examples:

```text
₹450
₹1,299
₹65,000
₹1,42,850
```

Use Indian numbering conventions.

Financial values should never be represented internally as floating-point money amounts.

---

# 7. Recommended React Native Architecture

## Platform strategy

### Phase 1 recommendation

**Android-first React Native application.**

Reason:

The product's defining capability depends on native device-level transaction-signal ingestion. Keep the native boundary explicit instead of hiding it behind generic UI code.

### Recommended stack

```text
React Native
TypeScript
React Navigation
Zustand
SQLite
React Hook Form
Zod
Native Android modules
Jest
React Native Testing Library
Detox
```

TanStack Query is not required for the core Phase 1 ledger because the primary source of truth is local SQLite rather than a remote server.

If a backend is added later, introduce TanStack Query at the API/repository boundary rather than moving local transaction state into it.

---

# 8. Feature-First Folder Architecture

Recommended project structure:

```text
tracker/
├── android/
├── ios/
├── src/
│   ├── app/
│   │   ├── navigation/
│   │   │   ├── RootNavigator.tsx
│   │   │   ├── MainTabs.tsx
│   │   │   └── routes.ts
│   │   ├── providers/
│   │   │   ├── AppProviders.tsx
│   │   │   └── ThemeProvider.tsx
│   │   └── App.tsx
│   │
│   ├── features/
│   │   ├── onboarding/
│   │   │   ├── screens/
│   │   │   ├── components/
│   │   │   ├── hooks/
│   │   │   ├── models/
│   │   │   └── index.ts
│   │   │
│   │   ├── home/
│   │   │   ├── screens/
│   │   │   ├── components/
│   │   │   ├── hooks/
│   │   │   └── index.ts
│   │   │
│   │   ├── pending/
│   │   │   ├── screens/
│   │   │   ├── components/
│   │   │   ├── hooks/
│   │   │   ├── state/
│   │   │   └── index.ts
│   │   │
│   │   ├── transactions/
│   │   │   ├── screens/
│   │   │   ├── components/
│   │   │   ├── hooks/
│   │   │   ├── state/
│   │   │   └── index.ts
│   │   │
│   │   ├── accounts/
│   │   │   ├── screens/
│   │   │   ├── components/
│   │   │   ├── hooks/
│   │   │   └── index.ts
│   │   │
│   │   └── detection/
│   │       ├── components/
│   │       ├── services/
│   │       ├── parsers/
│   │       ├── classifiers/
│   │       ├── models/
│   │       └── index.ts
│   │
│   ├── domain/
│   │   ├── transactions/
│   │   │   ├── transaction.types.ts
│   │   │   ├── transaction.rules.ts
│   │   │   └── transaction.service.ts
│   │   ├── accounts/
│   │   ├── categories/
│   │   └── audit/
│   │
│   ├── data/
│   │   ├── db/
│   │   │   ├── migrations/
│   │   │   ├── schema/
│   │   │   ├── connection.ts
│   │   │   └── database.ts
│   │   ├── repositories/
│   │   │   ├── transaction.repository.ts
│   │   │   ├── account.repository.ts
│   │   │   └── audit.repository.ts
│   │   └── mappers/
│   │
│   ├── native/
│   │   └── android/
│   │       ├── sms/
│   │       ├── notifications/
│   │       └── permissions/
│   │
│   ├── shared/
│   │   ├── ui/
│   │   │   ├── Button/
│   │   │   ├── Card/
│   │   │   ├── Chip/
│   │   │   ├── BottomSheet/
│   │   │   ├── TransactionRow/
│   │   │   └── AmountText/
│   │   ├── icons/
│   │   ├── hooks/
│   │   ├── utils/
│   │   ├── constants/
│   │   └── types/
│   │
│   ├── theme/
│   │   ├── colors.ts
│   │   ├── typography.ts
│   │   ├── spacing.ts
│   │   ├── radii.ts
│   │   ├── shadows.ts
│   │   └── index.ts
│   │
│   └── test/
│       ├── fixtures/
│       ├── builders/
│       └── helpers/
│
├── e2e/
├── docs/
│   ├── PROJECT.md
│   ├── DESIGN.md
│   ├── DECISIONS.md
│   └── WORKLOG.md
│
├── package.json
├── tsconfig.json
├── babel.config.js
└── README.md
```

---

# 9. Layering Rules

Use this dependency direction:

```text
UI
 ↓
Feature hooks
 ↓
Domain services
 ↓
Repositories
 ↓
SQLite / Native adapters
```

Do not allow:

```text
UI
 ↓
SQLite directly
```

Do not allow feature components to directly call Android native APIs.

Instead:

```text
Detection feature
      ↓
Detection service
      ↓
Native adapter
      ↓
Android API
```

This keeps the application testable.

---

# 10. State Management Strategy

## Zustand

Use Zustand for **UI/application state**, such as:

```text
selected tab
pending filter
search query
tour state
modal state
bottom-sheet state
temporary form state
```

Do not use Zustand as the primary database for transactions.

## SQLite

SQLite is the local source of truth for:

```text
transactions
accounts
categories
audit events
detection metadata
settings
```

## React Query

Introduce only when remote/server state exists.

For a future backend:

```text
Repository
   ↓
API client
   ↓
TanStack Query
```

Do not move the local ledger into React Query simply because it is available.

---

# 11. Core Data Model

## transactions

Suggested fields:

```text
id
type                    income | expense
status                  pending | approved | rejected | invalid
amount_minor            integer
currency                INR
merchant_name
category_id
account_id
payment_method
occurred_at
detected_at
approved_at
note
source_type
source_reference_hash
confidence_score
parser_version
created_at
updated_at
```

## accounts

```text
id
name
type                    bank | cash | credit_card | upi | other
last_four
opening_balance_minor
currency
is_active
created_at
updated_at
```

## categories

```text
id
name
parent_id
type                    income | expense | both
icon
is_system
```

## audit_events

```text
id
transaction_id
event_type
event_at
actor                   system | user
metadata_json
previous_hash           optional
event_hash              optional
```

The audit layer should explain **what happened and when** without forcing technical audit details into the normal UI.

---

# 12. Balance Rules

Do not treat the dashboard balance as an independently editable number.

For a normal cash/bank account:

```text
calculated_balance =
    opening_balance
  + approved_income
  - approved_expense
```

Pending transactions do not affect the balance.

Rejected transactions do not affect the balance.

For credit cards, model the balance according to the account semantics instead of pretending an outstanding liability is cash.

---

# 13. Detection Architecture

The detection subsystem should be independent from the UI.

```text
Native Signal
      ↓
Source Adapter
      ↓
Normalization
      ↓
Financial Message Filter
      ↓
Transaction Parser
      ↓
Transaction Classifier
      ↓
Merchant Resolver
      ↓
Category Suggestion
      ↓
Confidence Score
      ↓
Pending Transaction
```

## Source adapters

```text
SmsSourceAdapter
NotificationSourceAdapter
FutureApiSourceAdapter
```

## Normalized input

Use a common internal object:

```ts
type FinancialSignal = {
  source: 'sms' | 'notification' | 'manual';
  sender?: string;
  packageName?: string;
  receivedAt: string;
  body: string;
  stableSourceId?: string;
};
```

The detector should never depend directly on a specific screen component.

---

# 14. Detection Rules

Classify messages into semantic states:

```text
income
expense
refund
reversal
failed
otp
statement
promotion
unknown
```

Only appropriate financial events should create a Pending Transaction.

Examples:

```text
Debit / payment success
    -> candidate expense

Credit / received / salary
    -> candidate income

Refund
    -> candidate reversal/income adjustment

Payment failed
    -> no approved transaction

OTP
    -> ignore

Promotion
    -> ignore

Statement reminder
    -> ignore
```

Important:

**Do not rely on one keyword such as "debited".**

Use sender, message structure, amount extraction, transaction verbs, context, and confidence.

---

# 15. Detection Confidence

Every candidate can receive a confidence score.

Example policy:

```text
90–100
High confidence
Show Approve as primary

70–89
Needs review
Show Review more prominently

Below 70
Uncertain
Require review / do not offer fast approval
```

This is a product rule, not a license to auto-record.

**Confidence never equals approval.**

---

# 16. Privacy Architecture

The design repeatedly communicates an on-device model.

Architecturally:

```text
SMS / Notification
      ↓
Native Android
      ↓
Local parser
      ↓
Local SQLite
      ↓
React Native UI
```

Do not send raw banking messages to a server in Phase 1.

Do not store unnecessary raw message content.

Prefer:

```text
sanitized preview
source hash
parser metadata
```

over retaining complete sensitive message bodies.

Any sensitive implementation detail displayed in the UI should reflect what the actual implementation truly guarantees.

---

# 17. Native Boundary

Keep native code behind interfaces.

Example:

```ts
interface TransactionSignalSource {
  start(): Promise<void>;
  stop(): Promise<void>;
  getStatus(): Promise<SignalSourceStatus>;
  requestPermission(): Promise<PermissionResult>;
}
```

React Native should consume this contract.

Android implementations can later change without rewriting the feature UI.

Recommended adapters:

```text
AndroidSmsSignalSource
AndroidNotificationSignalSource
AndroidPermissionManager
```

---

# 18. Orchestra Method

## What "Orchestra" means for this project

Treat AI-assisted development as a coordinated set of specialized roles rather than asking one coding agent to build the entire application at once.

You are the **Conductor**.

The agents are specialists.

```text
                 CONDUCTOR
                     |
        +------------+------------+
        |            |            |
   Product/UX    Architecture   QA
        |            |            |
        +------------+------------+
                     |
              Feature Agents
                     |
          +----------+----------+
          |          |          |
        Home      Pending    Accounts
          |          |          |
          +----------+----------+
                     |
              Integration
                     |
                  QA Gate
                     |
                  Release
```

---

# 19. Orchestra Roles

## 19.1 Conductor

You control:

- current milestone;
- approved architecture;
- scope;
- design decisions;
- integration order;
- acceptance criteria.

The conductor must prevent agents from silently changing product requirements.

## 19.2 Product / UX Agent

Responsible for:

- screen behavior;
- interaction rules;
- state transitions;
- accessibility;
- UX consistency.

It does not own the database or native Android code.

## 19.3 Architecture Agent

Responsible for:

- folder structure;
- domain boundaries;
- dependency direction;
- data contracts;
- repository interfaces;
- native boundaries.

## 19.4 Design-System Agent

Responsible for:

- colors;
- typography;
- spacing;
- radii;
- reusable components;
- design-token compliance.

## 19.5 Feature Agents

Examples:

```text
Home Agent
Pending Agent
Transactions Agent
Accounts Agent
Onboarding Agent
```

A feature agent should work only inside its assigned feature + approved shared components.

## 19.6 Detection Agent

Owns:

- normalized financial signals;
- parser;
- classifiers;
- confidence logic;
- detection fixtures.

## 19.7 Native Agent

Owns:

- Android bridges;
- SMS/notification adapters;
- runtime permission handling;
- lifecycle integration.

## 19.8 QA Agent

Owns:

- unit tests;
- component tests;
- state-machine tests;
- integration tests;
- end-to-end tests;
- regression verification.

---

# 20. Orchestra Rules

## Rule 1 — One source of truth

`PROJECT.md`, `DESIGN.md`, and approved architecture decisions are the project contract.

Agents must not invent conflicting rules.

## Rule 2 — Small work packets

Never give an agent:

> "Build the whole app."

Instead:

> "Implement the Home pending-transaction section using the existing TransactionCard and PendingTransaction domain contract."

## Rule 3 — Contract before code

Before parallel work starts, define:

```text
types
props
repository interfaces
navigation contract
state machine
```

Then implementation can happen independently.

## Rule 4 — Shared components are centrally owned

Do not let five agents create five versions of:

```text
Button
Card
AmountText
TransactionRow
BottomSheet
```

Create shared primitives once.

## Rule 5 — Native code stays isolated

Feature agents cannot directly modify native SMS/notification modules unless the conductor assigns the work.

## Rule 6 — Every feature ends with tests

No feature is "done" when the screen renders.

Definition of done includes:

```text
UI
State
Persistence
Error handling
Tests
Accessibility
Design compliance
```

## Rule 7 — Integration after each milestone

Do not merge many unverified feature branches at the end.

Use:

```text
Feature
 ↓
Unit tests
 ↓
Integration
 ↓
Visual check
 ↓
Merge
```

---

# 21. Recommended Build Order

## Milestone 0 — Foundation

Build first:

```text
React Native project
TypeScript
Navigation
Theme
Fonts
Shared UI primitives
SQLite setup
Repository interfaces
Test setup
```

No SMS integration yet.

## Milestone 1 — Static UI

Implement:

```text
Home
Pending
Transaction Review
Transactions
Accounts
Tour
Permissions
```

Use fixture data.

Goal:

**Match the supplied designs before adding detection complexity.**

## Milestone 2 — Domain + Persistence

Implement:

```text
Transaction state machine
Account model
Category model
Audit events
SQLite repositories
Balance calculations
```

Connect the existing UI to real local data.

## Milestone 3 — Detection Engine

Implement offline fixtures first:

```text
message
 -> normalize
 -> classify
 -> parse
 -> confidence
 -> candidate transaction
```

Test many message formats.

## Milestone 4 — Android Native Signals

Implement:

```text
SMS signal adapter
Notification signal adapter
Permission adapter
```

Feed the native events into the existing detection engine.

The UI should not change.

## Milestone 5 — Approval Workflow

Implement:

```text
Approve
Edit
Reject
Undo where safe
Audit event
Balance recalculation
```

## Milestone 6 — Onboarding

Implement:

```text
Tour
Permission education
Permission request
Permission status
Manual mode fallback
```

## Milestone 7 — Hardening

Test:

- duplicate notifications;
- duplicate SMS;
- reversals;
- refunds;
- failed payments;
- income;
- expenses;
- malformed messages;
- unsupported banks;
- timezone/date changes;
- app restarts;
- database migrations;
- permission denial;
- notification permission revocation;
- device reboot.

---

# 22. Important Deduplication Rule

Transaction detection can easily receive the same event more than once.

Create a stable detection key.

For example:

```text
source
+
sender/package
+
normalized amount
+
occurred_at
+
reference
```

Hash the normalized identity and store it.

Before creating another Pending record:

```text
Does detection fingerprint already exist?
      |
  +---+---+
  |       |
 YES      NO
  |       |
Ignore   Create Pending
```

This should be treated as a core domain rule.

---

# 23. Manual Transaction Strategy

Manual `Add Record` must use the same domain model.

Recommended:

```text
Manual Entry
    ↓
Draft/Pending
    ↓
User confirmation
    ↓
Approved
```

This keeps the product's core promise consistent:

> A record is not financially committed until it is explicitly confirmed.

---

# 24. Error and Safety Rules

Never silently mutate balances.

Examples:

### Failed parse

```text
Do not create approved transaction.
Show:
"Could not confidently identify this transaction."
```

### Duplicate

```text
Ignore duplicate signal.
Keep original pending/approved record.
```

### Reversal

```text
Link reversal to original transaction.
Do not create an unrelated duplicate expense.
```

### Refund

```text
Represent the refund as a separate financial event linked to the original transaction.
```

### Invalid amount

```text
Do not create pending transaction.
```

---

# 25. Testing Pyramid

## Unit tests

Test:

```text
amount parsing
merchant parsing
date parsing
classification
confidence
deduplication
balance calculations
state transitions
```

## Component tests

Test:

```text
TransactionCard
ApprovalButton
ReviewSheet
AmountText
AccountCard
Pending filters
```

## Integration tests

Test:

```text
Signal
 -> Parser
 -> Repository
 -> Pending UI
```

and:

```text
Approve
 -> Repository
 -> Account balance
 -> History
```

## E2E tests

Critical flows:

```text
Launch
 -> Tour
 -> Permissions
 -> Home

Detection
 -> Pending
 -> Approve
 -> Transactions

Detection
 -> Review
 -> Edit
 -> Approve

Detection
 -> Reject
 -> No balance change
```

---

# 26. Visual QA

Every screen should be checked against the supplied design reference.

Check:

- typography;
- spacing;
- button heights;
- card radius;
- icon alignment;
- INR formatting;
- bottom-safe-area spacing;
- dark balance card;
- green primary actions;
- amber pending state;
- transaction row density.

Do not let functional implementation slowly destroy the visual system.

---

# 27. AI Agent Task Template

Use this structure when delegating a task to an AI coding agent:

```text
ROLE
You are the [ROLE] responsible for [AREA].

PROJECT CONTEXT
Tracker is a local-first personal finance application.
Core lifecycle:
Detect -> Review if needed -> Approve -> Record.

SOURCE OF TRUTH
Read:
- docs/PROJECT.md
- docs/DESIGN.md
- relevant feature files

TASK
Implement only:
[exact task]

DO NOT
- change architecture
- add unrelated dependencies
- modify other features
- create duplicate shared components
- bypass repositories
- bypass the transaction state machine

CONTRACT
Use:
[type/interface/repository/navigation contract]

DESIGN
Follow:
- existing tokens
- existing shared components
- supplied screen behavior

ACCEPTANCE CRITERIA
1.
2.
3.

TESTING
Add/update:
- unit tests
- component tests
- integration tests where applicable

OUTPUT
Return:
- files changed
- architecture impact
- tests added
- known limitations
```

---

# 28. Conductor Prompt

Use this as the main orchestration prompt for an AI coding session:

```text
You are the Conductor for the Tracker React Native project.

Read PROJECT.md and DESIGN.md before making changes.

Your responsibility is to coordinate implementation, not to invent architecture.

Core product rule:

DETECT -> REVIEW IF NEEDED -> APPROVE -> RECORD

Transactions must not affect approved balances until explicitly approved.

Before changing code:

1. Identify the affected feature.
2. Read the existing implementation.
3. Check domain contracts and shared components.
4. Check whether another feature owns the required abstraction.
5. Plan the smallest implementation unit.
6. Implement only the requested scope.
7. Run relevant tests.
8. Report architectural impact.

Architecture rules:

- Feature-first modules.
- UI does not access SQLite directly.
- UI does not call Android native APIs directly.
- Repositories own persistence access.
- Domain services own transaction rules.
- Native adapters own Android platform access.
- Zustand is for UI/application state.
- SQLite is the local financial source of truth.
- Do not put transactions into a global UI store as the database.
- No raw financial message should leave the device in Phase 1.

Design rules:

- Follow DESIGN.md tokens.
- Reuse shared components.
- Preserve Plus Jakarta Sans.
- Preserve the supplied green/obsidian/amber visual language.
- Preserve the four-tab navigation.
- Use progressive disclosure for audit information.

When a requirement is ambiguous:

Do not silently choose a major architecture change.
Present the smallest reasonable interpretation and identify the decision.

When a feature is complete:

- verify behavior;
- verify persistence;
- verify state transitions;
- verify tests;
- verify visual consistency.
```

---

# 29. First 10 Development Tasks

Do these in this exact order:

```text
01  Create React Native + TypeScript project
02  Add theme/design tokens from DESIGN.md
03  Add Plus Jakarta Sans
04  Build shared UI primitives
05  Build navigation shell
06  Build fixture-driven Home
07  Build Pending + Review bottom sheet
08  Build Transactions + Details
09  Build Accounts
10  Add SQLite repositories and connect the domain
```

Only after these are stable:

```text
11  Detection engine
12  Android SMS adapter
13  Android notification adapter
14  Permission flow
15  Deduplication
16  Approval/ledger integration
17  E2E tests
18  Production hardening
```

---

# 30. What NOT to Build First

Do not start with:

```text
AI financial assistant
cloud sync
backend
authentication
investment tracking
budgets
advanced analytics
LLM classification
multi-device sync
```

The strongest technical foundation for this product is:

```text
Beautiful UI
+
Correct transaction state machine
+
Reliable local persistence
+
Reliable detection pipeline
+
Explicit approval
```

Everything else can be layered onto that foundation later.

---

# 31. Project Definition of Done

A Phase 1 release is done when:

```text
[ ] All primary screens match the approved design direction
[ ] Navigation is stable
[ ] Onboarding/tour is complete
[ ] Accounts are persisted locally
[ ] Income and expense records are persisted locally
[ ] Pending transactions are separated from approved records
[ ] Approval changes the ledger exactly once
[ ] Rejection never affects balances
[ ] Duplicate detections do not duplicate transactions
[ ] Balance calculations are deterministic
[ ] Audit events are created for important state changes
[ ] Sensitive source data is minimized
[ ] Detection can be disabled
[ ] App works without a backend
[ ] Unit tests exist for core transaction rules
[ ] Component tests exist for approval UI
[ ] E2E tests cover the primary approval journey
[ ] Visual QA has been performed against the supplied designs
```

---

# 32. Immediate Next Step

Start with **Milestone 0**, not SMS detection.

The first implementation target should be:

```text
RN App
  ↓
Theme
  ↓
Navigation
  ↓
Shared components
  ↓
Fixture data
  ↓
Home
  ↓
Pending
  ↓
Review
  ↓
Transactions
  ↓
Accounts
```

Once the UI/state skeleton is stable, connect SQLite.

Then connect detection.

This keeps the highest-risk native transaction-ingestion work isolated from the visual product work and lets multiple AI agents work in parallel without stepping on each other.

---

## Architecture at a glance

```text
                           TRACKER
                              |
                    ┌─────────┴─────────┐
                    |                   |
                 UI LAYER           DOMAIN LAYER
                    |                   |
        ┌───────────┼──────────┐        |
        |           |          |        |
      Home       Pending   Transactions |
        |           |          |        |
        └───────────┴──────────┘        |
                    |                   |
             Feature Hooks              |
                    |                   |
             Zustand (UI)               |
                    |                   |
              Domain Services <---------+
                    |
             Repository Interfaces
                    |
          ┌─────────┴─────────┐
          |                   |
       SQLite            Native Adapters
          |                   |
          |             ┌─────┴─────┐
          |             |           |
          |            SMS      Notifications
          |             |           |
          |             └─────┬─────┘
          |                   |
          └───────────── Detection Engine
                              |
              Normalize → Parse → Classify
                              |
                         Confidence
                              |
                         Pending Queue
                              |
                         USER APPROVAL
                              |
                        Approved Ledger
                              |
                  ┌───────────┴───────────┐
                  |           |           |
               Balance     History      Audit
```

## Final architecture principle

**The UI should never decide whether money is real. The domain state machine decides that.**

The detector proposes a transaction.

The user approves it.

The domain layer commits it.

The account balance is derived from approved records.

That separation is the foundation that will keep Tracker reliable as the application grows.
