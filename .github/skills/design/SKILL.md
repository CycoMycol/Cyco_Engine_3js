---
name: design
description: # **design.md**

# **Project Design Document**

## **Purpose**

This document defines the architectural structure of the project.

It is the authoritative source of truth for AI assistants and developers.

## **Edge Case Handling**

When a request falls outside the defined architecture or system boundaries, pause and clarify intent before proceeding. Do not silently invent conventions or systems.

---

# **Technology Stack**

Rendering:

* Three.js  
* WebGL  
* WebGPU

Physics:

* Rapier

Language:

* TypeScript  
* JavaScript

Architecture:

* ECS preferred

---

# **Architecture Map**

Input  
→ Controllers  
→ Gameplay Systems  
→ Physics Systems  
→ Animation Systems  
→ Rendering Systems

Asset Pipeline  
→ Loaders  
→ Resource Cache  
→ Runtime Assets

Networking  
→ Message Layer  
→ State Layer  
→ Gameplay Layer

UI  
→ Components  
→ View Models  
→ State Layer

---

# **System Boundaries**

Input System

Responsibilities:

* Input collection  
* Device handling  
* Input mapping

Not responsible for:

* Physics  
* Rendering  
* Gameplay decisions

---

Gameplay System

Responsibilities:

* Rules  
* State changes  
* Progression

Not responsible for:

* Rendering  
* Physics integration details

---

Physics System

Responsibilities:

* Simulation  
* Collision  
* Character controllers

Not responsible for:

* Rendering  
* UI

---

Rendering System

Responsibilities:

* Visual output  
* Materials  
* Cameras  
* Lighting

Not responsible for:

* Gameplay logic

---

# **Dependency Rules**

Allowed:

Input → Gameplay

Gameplay → Physics

Gameplay → Rendering

Rendering → GPU

Not Allowed:

UI → Physics

Rendering → Gameplay State Mutation

Physics → UI

If a user request would require violating a Dependency Rule, do not implement it as requested. Instead, explain which rule would be violated and propose a compliant alternative that achieves the user's intent.

---

# **Reconstruction Rules**

When rebuilding projects:

* Preserve original architecture  
* Preserve naming conventions  
* Preserve file layout  
* Preserve execution flow

Do not propose architectural changes until all recoverable systems have been documented and their behaviors verified. If a gap cannot be recovered, document it explicitly before proposing a replacement design.

If the original architecture, naming convention, or file layout cannot be determined from available sources, document the gap explicitly under Reverse Engineering Rules and halt reconstruction of that component until clarification is provided. Do not infer and silently apply a convention.

---

# **Reverse Engineering Rules**

Document:

* Recovered systems  
* Recovered behaviors  
* Assumptions  
* Missing components

Keep reconstruction decisions traceable.

When introducing a system that does not map to an existing category, document it as a new or added system, define its responsibilities and non-responsibilities in the System Boundaries format, and obtain explicit approval before wiring its dependencies.

---

# **AI Modification Rules**

AI assistants must:

* Preserve architecture  
* Avoid duplicate systems  
* Avoid duplicate logic  
* Limit changes to files and functions directly required to implement the requested behavior. Do not modify unrelated files, rename existing symbols, or restructure code that is not broken.
* Remove temporary debug code only within files already being modified
* Do not refactor code unless the refactor is explicitly requested by the user or is strictly required to implement the requested change. Do not refactor code solely because it could be cleaner or more idiomatic.
* Follow existing conventions

When these rules conflict, apply them in this priority order: (1) Preserve architecture, (2) Follow existing conventions, (3) Use minimal changes, (4) Remove temporary debug code only within files already being modified.

