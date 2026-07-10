# Web architecture

The web client keeps rendering replaceable by separating four responsibilities:

- `api/`: transport-independent response and request contracts plus the HTTP client.
- `services/`: feature-oriented API operations. URL and HTTP method details belong here.
- `app/`: application state, polling, project selection, and the top-level view contract.
- `features/`: feature containers and UI components for board, tasks, planning, agents, settings, and activity.
- `shared/`: presentation helpers used by more than one feature.
- `styles/`: ordered style sheets grouped by UI area.

`App.tsx` only connects `useAppController` to `AppView`. A replacement top-level view can consume the same `AppController` without importing the HTTP client or knowing endpoint URLs. Feature components use the service layer for mutations, so transport changes stay outside JSX files.

Dependency direction:

```text
App -> AppView -> feature components -> services -> api/client
          ^                                |
          |                                v
     AppController -----------------> api/contracts
```

When adding a feature:

1. Add or extend its contract in `api/contracts.ts`.
2. Add endpoint operations to a focused service in `services/`.
3. Keep server calls out of `app/AppView.tsx` and shared presentation helpers.
4. Place feature state and rendering under a matching `features/<name>/` folder.
