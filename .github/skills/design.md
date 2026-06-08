# **design.md**

# **Project Design Document**

## **Purpose**

This document defines the architectural structure of the project.

It is the authoritative source of truth for AI assistants and developers.

---

# **Technology Stack**

Rendering:

* Three.js  
* WebGL  
* WebGPU

Physics:

* Rapier

Language:

* Java  
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

---

# **Reconstruction Rules**

When rebuilding projects:

* Preserve original architecture  
* Preserve naming conventions  
* Preserve file layout  
* Preserve execution flow

Recover before redesigning.

---

# **Reverse Engineering Rules**

Document:

* Recovered systems  
* Recovered behaviors  
* Assumptions  
* Missing components

Keep reconstruction decisions traceable.

---

# **AI Modification Rules**

AI assistants must:

* Preserve architecture  
* Avoid duplicate systems  
* Avoid duplicate logic  
* Use minimal changes  
* Remove temporary debug code  
* Avoid speculative refactors  
* Follow existing conventions

