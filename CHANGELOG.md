# Changelog

All notable changes to this project will be documented in this file. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/).

Per-version release notes for tagged releases are published on the [GitHub Releases page](https://github.com/WYRE-AI/alloy-navigator-mcp/releases) - `semantic-release` generates them from commit history at release time.

## [Unreleased]

### Added

- Initial v1 release: 4 read-only tools covering Alloy Navigator's generic object-class API - list/search objects of any class (Incidents, Work Orders, Computers, Consumables, SoftwareCatalog, etc.), get a single object's full field data, get an object's activity/history log, and resolve a field's reference/classification values. OAuth2 client_credentials (application account) authentication against a per-instance base URL - Alloy Navigator has no shared hosted endpoint; every instance is on-prem or self-hosted-cloud. See README's Scope section for the full list of deliberately excluded workflow-action, object-creation, and administration endpoints.
