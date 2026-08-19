import {
  describe,
  expect,
  it,
} from "vitest";
import {
  closestServicesFolderPosition,
  servicesFolderDragDirection,
  servicesFolderVisibleOffsets,
  wrapServicesFolderIndex,
} from "../components/services/services-folder-carousel-model";

describe(
  "Internal Services folder carousel model",
  () => {
    it(
      "wraps forward and backward forever",
      () => {
        expect(
          wrapServicesFolderIndex(
            0,
            8,
          ),
        ).toBe(0);

        expect(
          wrapServicesFolderIndex(
            8,
            8,
          ),
        ).toBe(0);

        expect(
          wrapServicesFolderIndex(
            9,
            8,
          ),
        ).toBe(1);

        expect(
          wrapServicesFolderIndex(
            -1,
            8,
          ),
        ).toBe(7);

        expect(
          wrapServicesFolderIndex(
            -9,
            8,
          ),
        ).toBe(7);
      },
    );

    it(
      "chooses the nearest virtual copy of a selected folder",
      () => {
        expect(
          closestServicesFolderPosition(
            7,
            0,
            8,
          ),
        ).toBe(8);

        expect(
          closestServicesFolderPosition(
            -1,
            7,
            8,
          ),
        ).toBe(-1);

        expect(
          closestServicesFolderPosition(
            17,
            1,
            8,
          ),
        ).toBe(17);
      },
    );

    it(
      "responds to meaningful drag distance or velocity",
      () => {
        expect(
          servicesFolderDragDirection(
            -90,
            0,
            420,
          ),
        ).toBe(1);

        expect(
          servicesFolderDragDirection(
            90,
            0,
            420,
          ),
        ).toBe(-1);

        expect(
          servicesFolderDragDirection(
            -12,
            -0.5,
            420,
          ),
        ).toBe(1);

        expect(
          servicesFolderDragDirection(
            12,
            0.5,
            420,
          ),
        ).toBe(-1);

        expect(
          servicesFolderDragDirection(
            8,
            0.05,
            420,
          ),
        ).toBe(0);
      },
    );

    it(
      "keeps center and side folders visible",
      () => {
        expect(
          servicesFolderVisibleOffsets(
            8,
          ),
        ).toEqual(
          [-1, 0, 1],
        );

        expect(
          servicesFolderVisibleOffsets(
            2,
          ),
        ).toEqual(
          [-1, 0, 1],
        );

        expect(
          servicesFolderVisibleOffsets(
            1,
          ),
        ).toEqual([0]);
      },
    );
  },
);