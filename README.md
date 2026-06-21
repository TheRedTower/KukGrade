# Grading App

This repository contains the code for the single‑discipline martial arts grading management system.

## Structure

- **api/** – Django backend providing RESTful APIs, authentication and data models.
- **web/** – React + TypeScript frontend built with Vite.  It consumes the API and provides the UI.
- **worker/** – background worker for asynchronous tasks (e.g., certificate generation and notifications).  Initially unused.
- **docs/** – project documentation, including architecture diagrams, API specifications and user guides.
- **README.md** – this file.

Refer to the planning document for detailed implementation steps.
