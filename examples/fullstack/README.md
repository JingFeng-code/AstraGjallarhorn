# Synthetic full-stack verification fixture

This fixture checks a small Vue form through a real local HTTP request, ASP.NET Core Minimal API, service and repository layers, temporary SQLite storage, and the rendered browser UI. The verifier reads SQLite independently instead of relying only on the API response.

The fixture uses synthetic data and a temporary database, browser profile, and dynamically assigned localhost port. It exercises the normal case, injects a title-normalization defect in a disposable copy, then verifies the corrected behavior through the browser, HTTP response, database state, and rendered UI. Oversized input is also rejected. Temporary processes and files are cleaned up after the run.

Requirements are Node.js 24, .NET SDK 10.0.401, and Microsoft Edge. The repository keeps its existing Vue dependencies and uses Node's built-in SQLite support as the local subprocess adapter; the repository fixture is not an EF Core implementation. It does not use a production database, modify Pi settings, call a model, or run cloud CI.

Run from the repository root:

    node tests/fullstack-fixture.mjs

This is a local synthetic integration check, not an OS sandbox or a certification of other databases or deployment environments.
