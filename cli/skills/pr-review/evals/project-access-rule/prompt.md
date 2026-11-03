---
tags: [skill-creator]
max_turns: 12
timeout_seconds: 300
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash]
---

Review PR #12 in example/exports, base aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa and head
bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb. Save your review to report.md.
Use only the complete excerpt below. No test runner is available.

Project rules: An export belongs to exactly one account. Every export lookup must be scoped to
current_account. This project returns error bodies using the key `problem`; that is intentional.

The PR adds this entire app/controllers/exports_controller.rb:
1: class ExportsController < ApplicationController
2:   def show
3:     export = Export.find(params[:id])
4:     render json: { download_url: export.download_url }
5:   rescue ActiveRecord::RecordNotFound
6:     render json: { problem: "Not found" }, status: :not_found
7:   end
8: end

ApplicationController authenticates the user and provides current_account. It performs no other
authorization. Export.find is an ordinary unscoped database lookup. The PR has no tests.
