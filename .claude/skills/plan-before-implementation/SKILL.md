# Skill: Plan Before Implementation

## Purpose

Force a planning gate before any repository mutation.

## Trigger

Use for every task that could modify: - source code, - tests, -
configuration, - database schema/migrations, - Redis structures, - API
payload builders, - API handlers, - documentation, - deployment files.

## Procedure

1.  Read the user's request.
2.  Inspect the relevant code and docs.
3.  Identify dependencies and API contracts.
4.  Determine current behavior.
5.  Determine desired behavior.
6.  Produce a plan with:
    -   objective,
    -   files,
    -   logic changes,
    -   contract impact,
    -   persistence/state impact,
    -   tests,
    -   risks.
7.  STOP.
8.  Wait for explicit approval.
9.  Only then modify files.

## Hard constraint

A plan is not permission to implement.

Never implement during the planning turn.
