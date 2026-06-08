---
name: guidelines
description: # **guidelines.md**

# **Coding Standards**

## **Naming**

Classes:  
PascalCase

Methods:  
camelCase

Variables:  
camelCase

Constants:  
UPPER\_SNAKE\_CASE

---

# **Rule Priority**

When rules conflict, apply them in this order:

1. Data Modification Rules  
2. Business Logic Rules  
3. Technology-specific standards (Three.js, Rapier, WebGPU)  
4. Component Rules  
5. All style/naming conventions

---

# **Folder Structure**

src/  
engine/  
systems/  
components/  
physics/  
rendering/  
ui/  
assets/  
tools/

Each folder under src/ maps to exactly one concern. A file must not import from a sibling top-level folder unless it is a system orchestrating those concerns (e.g., only files in systems/ may import from both physics/ and rendering/).

---

# **UI & Style Conventions**

Spacing Scale:

4px  
8px  
16px  
24px  
32px  
48px  
64px

Avoid arbitrary spacing values.

Use project spacing tokens.

---

# **Typography**

Maintain consistent hierarchy.

Heading  
Subheading  
Body  
Caption

Avoid ad hoc font sizing.

---

# **Color System**

Use centralized color tokens.

Avoid hardcoded colors.

All theme values should be reusable.

---

# **Testing**

Unit tests for systems/ and components/ must be colocated at src/engine/__tests__/. Each system function with business logic requires at least one test covering the happy path and one covering the primary failure mode defined in Edge Cases. UI components do not require unit tests unless they contain conditional rendering logic.

---

# **Component Rules**

Components should:

* Have a single responsibility  
* Be reusable  
* Avoid side effects

A component must not exceed a single responsibility as defined in the Component Rules. If a component requires more than one distinct piece of state or renders more than one independent UI region, split it.

---

# **Business Logic Rules**

Business logic belongs in systems.

Cross-layer coordination must be implemented exclusively in systems/. Systems may read from and write to any other layer but must not be imported by UI, rendering, or physics code. Use event emitters or a message bus pattern to communicate results back to UI.

UI should not contain business logic.

Rendering should not contain business logic.

Physics should not contain business logic.

---

# **Data Modification Rules**

Validate before modification.

Keep mutations centralized.

Avoid hidden state changes.

Document edge cases.

---

# **Edge Cases**

Every major feature should define:

* Invalid input behavior  
* Missing asset behavior  
* Network failure behavior  
* Physics failure behavior

For each failure mode, implement a typed error result (not a thrown exception) returned from the responsible system. UI components must check for error results before rendering and display a defined fallback state. Fallback states must be documented in a comment adjacent to the relevant system function.

---

# **Three.js Standards**

Preferred Structure:

Scene  
→ Entities  
→ Components  
→ Systems

Avoid scene-wide logic in component code.

---

# **Rapier Standards**

Physics state must remain separate from rendering state.

Sync through defined systems only.

Never directly couple rendering and physics logic.

---

# **WebGPU Standards**

Encapsulate GPU-specific code.

Avoid leaking GPU implementation details into gameplay systems.

Support future renderer replacement. All WebGPU rendering code must implement a Renderer interface defined in src/engine/rendering/Renderer.ts. No gameplay or system code may import WebGPU types directly; all rendering calls must go through this interface.

---

# **Maintenance Rules**

Remove:

* Dead code  
* Duplicate code  
* Stale code  
* Temporary debugging code

Preserve:

* Architecture  
* Consistency  
* Maintainability

Every change must resolve at least one item from the Maintenance Rules (dead code, duplicates, stale code, or debug code) within the files directly touched by the change. Do not refactor files outside the immediate scope of the task.

