# AI-Internship-Office

Persistent internship research, council review, preparation, approval and application records with an interactive 3D workspace.

Created as a source snapshot on October 6, 2026 from Abubakr Mozawalla’s working project and approved Obsidian documentation. The repository describes a personal prototype; it does not claim client results or measured application throughput.

## Architecture

`pipeline.py` owns evidence snapshots, deduplication, council rounds and eligibility gates. `review_inbox.py` owns version-bound approvals. `office.py` is the local bridge. `server.py` serves the workspace and records. `robot_chat.py` provides budgeted per-system conversations separately from execution. `dist/ai-world.js` maps project stations to records and chats. The Three.js renderer in `graphics/src/` makes no model calls.

Council workflow: candidate + opportunity packet → five independent perspectives → challenge round → decision → truthful materials → portal preparation → authorized submission → employer confirmation. Saved state is not proof of a running agent.

## Run

Python 3.11+; standard library. Start `python3 server.py` and open the printed localhost URL. This export initializes an empty workspace, disables model chats, and uses a synthetic profile. Configure your own profile and document files locally before using application features. External portal execution and production deployment require their own configuration.

Run checks with `python3 -m unittest discover -s tests`. This source snapshot has not been certified for production deployment.

## Export boundaries

The snapshot includes actual implementation code and configuration examples. Databases, applicant information, resumes, account sessions, machine-specific deployment files, emails, prospect records, raw footage and generated media are excluded. Private working copies remain separate.
