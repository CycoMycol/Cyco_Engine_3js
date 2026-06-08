# **guidelines.md**

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

Keep responsibilities separated.

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

# **Component Rules**

Components should:

* Have a single responsibility  
* Be reusable  
* Avoid side effects

Avoid large monolithic components.

---

# **Business Logic Rules**

Business logic belongs in systems.

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

Handle failures gracefully.

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

Support future renderer replacement.

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

Every change should leave the codebase cleaner than it was found.

