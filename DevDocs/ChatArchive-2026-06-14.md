# Cyco Engine Chat Archive

Date: 2026-06-14

## What Was Restored

- Restored the New Project flow to the folder-based save path.
- Kept the local bridge picker behavior that returns a selected folder path.
- Preserved the `.cyco` project write path through the bridge.
- Removed the later file-picker-only direction from the New Project flow.

## Backup State

- Backup commit: `11270e1`
- Backup branch: `backup/new-project-folder-save-state`

## Notes

- The working state is on the main engine branch and also captured on the backup branch.
- The local save bridge is the active folder picker path for New Project.
