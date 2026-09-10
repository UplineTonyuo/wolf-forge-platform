import { describe, expect, it } from "vitest";
import {
  locateYoutubeSeoLinkColumns,
  parseYoutubeSeoWorkflowRows,
} from "../domain/operations/youtube-seo-workflow";

describe("YouTube SEO workflow domain", () => {
  it("parses full and reduced stacked blocks, resolving duplicate Notes/Assigned VA columns via first non-blank", () => {
    const rows = [
      ["Name", "Email", "Logins", "NOTE", "Order #", "SEO Package", "Primary Keyword", "City", "PROMPT/ SOP", "4 Wave Videos", "STATUS 1", "Assigned VA", "4 YOUTUBE UPLOADED", "STATUS 2", "Assigned VA", "NOTE"],
      ["https://complete.example", "team@example.com", "https://docs.example/login", "", "WF-1", "Platinum", "junk removal", "Austin", "https://docs.example/sop", "https://docs.example/wave", "Completed", "Rap", "https://docs.example/upload", "Completed", "Rap", "no blog post link"],
      [],
      ["Ibrahim Barhumi - GMB Management https://docs.example/leader"],
      ["Name", "Assigned VA", "Wave Video", "STATUS 1", "YT Uploaded", "STATUS 2", "Assigned VA", "Notes"],
      ["Reduced Client", "", "https://docs.example/wave2", "Inprogress", "https://docs.example/upload2", "Inprogress", "Anthony", ""],
    ];

    const items = parseYoutubeSeoWorkflowRows(rows, "YT SEO September 2026");
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      clientUrl: "https://complete.example",
      seoPackage: "Platinum",
      assignedVa: "Rap",
      notes: "no blog post link",
      normalizedStatus: "completed",
      waveStage: { state: "completed", outputUrl: "https://docs.example/wave" },
      youtubeStage: { state: "completed", outputUrl: "https://docs.example/upload" },
    });
    expect(items[1]).toMatchObject({
      sourceSection: "Ibrahim Barhumi - GMB Management https://docs.example/leader",
      assignedVa: "Anthony",
      normalizedStatus: "in_progress",
    });
  });

  it("uses deterministic blocker, pause, cancellation, completion, and progress precedence, including numeric-suffixed 'Done' vocabulary", () => {
    const header = ["Name", "Wave Video", "Status", "YT Uploaded", "Status 1", "Notes"];
    const rows = [
      header,
      ["Blocked", "wave file", "4 wave video Done", "", "STUCK", "need to verify"],
      ["Paused", "wave file", "Pause", "upload file", "Pause", ""],
      ["Cancelled", "", "cancelled", "", "", ""],
      ["Progress", "wave file", "Inprogress", "", "", ""],
      ["AllDone", "wave file", "10 YT Done", "upload file", "4 wave video Done", ""],
    ];
    expect(parseYoutubeSeoWorkflowRows(rows, "YT SEO August 2026").map((item) => item.normalizedStatus)).toEqual([
      "stuck",
      "paused",
      "cancelled",
      "in_progress",
      "completed",
    ]);
  });

  it("locates all real resource columns across header variants", () => {
    const rows = [
      ["Name", "Logins", "PROMPT/ SOP", "4 Wave Videos", "STATUS 1", "4 YOUTUBE UPLOADED", "STATUS 2"],
      [],
      ["Name", "Wave Video", "Status", "YT Uploaded", "Status 1"],
    ];
    expect(locateYoutubeSeoLinkColumns(rows)).toEqual([0, 1, 2, 3, 5]);
  });
});
