import {
  describe,
  expect,
  it,
} from "vitest";
import {
  circularFolderDeskOffset,
  folderDeskDragDirection,
  folderDeskRenderable,
  wrapFolderDeskIndex,
} from "../components/services/services-folder-workspace-model";

describe(
  "Services vertical folder desk",
  () => {
    it(
      "wraps folder indexes infinitely",
      () => {
        expect(
          wrapFolderDeskIndex(
            8,
            8,
          ),
        ).toBe(0);

        expect(
          wrapFolderDeskIndex(
            -1,
            8,
          ),
        ).toBe(7);
      },
    );

    it(
      "places next above and previous below",
      () => {
        expect(
          circularFolderDeskOffset(
            4,
            3,
            8,
          ),
        ).toBe(1);

        expect(
          circularFolderDeskOffset(
            2,
            3,
            8,
          ),
        ).toBe(-1);

        expect(
          circularFolderDeskOffset(
            0,
            7,
            8,
          ),
        ).toBe(1);
      },
    );

    it(
      "maps vertical physical drag to deck direction",
      () => {
        expect(
          folderDeskDragDirection(
            90,
            0,
            500,
          ),
        ).toBe(1);

        expect(
          folderDeskDragDirection(
            -90,
            0,
            500,
          ),
        ).toBe(-1);

        expect(
          folderDeskDragDirection(
            8,
            0.03,
            500,
          ),
        ).toBe(0);
      },
    );

    it(
      "keeps the incoming hidden folder mounted during movement",
      () => {
        expect(
          folderDeskRenderable(
            2,
            1,
          ),
        ).toBe(true);

        expect(
          folderDeskRenderable(
            -2,
            -1,
          ),
        ).toBe(true);

        expect(
          folderDeskRenderable(
            4,
            1,
          ),
        ).toBe(false);
      },
    );
  },
);