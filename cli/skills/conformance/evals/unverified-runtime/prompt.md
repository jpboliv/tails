---
tags: [skill-creator]
max_turns: 12
timeout_seconds: 300
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash]
---

Assess ticket APP-42 against these requirements and save a requirement-by-requirement Markdown report
to report.md. The code PR is example/exports#12 at bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.
The spec repository is example/specs at aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.
These are the complete inputs. No runner, environment measurements, or release data are available.

prds/APP-1-export.md:
1: - **FR-1.1** Invalid export requests return HTTP 422 with a reason.
2: - **FR-1.2** Every export finishes within two seconds under the production peak load.

app/export.rb:
1: def create_export(valid:)
2:   return [400, { reason: "Invalid request" }] unless valid
3:   [200, { url: ExportJob.run }]
4: end

test/export_test.rb:
1: def test_fast_export
2:   assert_operator measure_seconds { create_export(valid: true) }, :<, 2
3: end

This test file exists but no test run was supplied.
