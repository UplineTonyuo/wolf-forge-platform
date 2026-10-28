"use client";

import { useRouteTransitionPush } from "../shell/route-transition";

import { ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type TransitionEvent,
  type WheelEvent,
} from "react";
import {
  closestServicesFolderPosition,
  servicesFolderDragDirection,
  servicesFolderVisibleOffsets,
  wrapServicesFolderIndex,
} from "./services-folder-carousel-model";
import styles from "./services-folder-carousel.module.css";

export type ServicesFolderCarouselItem = {
  id: string;
  name: string;
  description: string | null;
  serviceCount: number;
  system?: boolean;
};

type DragState = {
  pointerId: number;
  startX: number;
  lastX: number;
  lastAt: number;
  velocityX: number;
};

type MotionPhase =
  | "prepare"
  | "animating"
  | "recycle"
  | "settling";

type MotionState = {
  phase: MotionPhase;
  direction: -1 | 1;
  outgoingId: string;
};

type SlotVisual = {
  x: string;
  y: string;
  scale: number;
  rotate: string;
  opacity: number;
  zIndex: number;
};

const CLICK_SUPPRESS_DISTANCE = 7;
const WHEEL_LOCK_MS = 160;

function folderRoute(id: string) {
  return `/services?folder=${encodeURIComponent(id)}`;
}

function countLabel(count: number) {
  return `${count} ${count === 1 ? "service" : "services"}`;
}

function idleSlotVisual(offset: number): SlotVisual {
  if (offset === 0) {
    return {
      x: "0%",
      y: "-7%",
      scale: 1,
      rotate: "0deg",
      opacity: 1,
      zIndex: 50,
    };
  }

  if (Math.abs(offset) === 1) {
    return {
      x: `${offset * 53}%`,
      y: "17%",
      scale: 0.78,
      rotate: `${offset * 6.4}deg`,
      opacity: 0.44,
      zIndex: 20,
    };
  }

  return {
    x: `${offset * 42}%`,
    y: "29%",
    scale: 0.66,
    rotate: `${offset > 0 ? 9 : -9}deg`,
    opacity: 0,
    zIndex: 5,
  };
}

function outgoingDropVisual(direction: -1 | 1): SlotVisual {
  return {
    x: `${direction * -8}%`,
    y: "44%",
    scale: 0.88,
    rotate: `${direction * -4.5}deg`,
    opacity: 0.74,
    zIndex: 8,
  };
}

function trailingBackVisual(direction: -1 | 1): SlotVisual {
  return {
    x: `${direction * -73}%`,
    y: "27%",
    scale: 0.68,
    rotate: `${direction * -9}deg`,
    opacity: 0.12,
    zIndex: 5,
  };
}

function motionVisual(
  offset: number,
  itemId: string,
  motion: MotionState | null,
): SlotVisual {
  const idle = idleSlotVisual(offset);

  if (!motion || motion.phase === "prepare") {
    return idle;
  }

  if (motion.phase === "animating") {
    if (offset === 0) {
      return outgoingDropVisual(motion.direction);
    }

    if (offset === motion.direction) {
      return idleSlotVisual(0);
    }

    if (offset === -motion.direction) {
      return trailingBackVisual(motion.direction);
    }

    if (offset === motion.direction * 2) {
      return idleSlotVisual(motion.direction);
    }

    return idle;
  }

  if (
    motion.phase === "recycle" &&
    itemId === motion.outgoingId
  ) {
    return outgoingDropVisual(motion.direction);
  }

  return idle;
}

function FolderContents({
  item,
  center,
  selected,
}: {
  item: ServicesFolderCarouselItem;
  center: boolean;
  selected: boolean;
}) {
  const longName = item.name.length > 24;

  return (
    <span className={styles.folderObject}>
      <span className={styles.folderBack} aria-hidden="true" />

      <span className={styles.folderTab}>
        <span className={styles.tabLabel}>
          {item.system ? "SYSTEM FOLDER" : "SERVICE FOLDER"}
        </span>
      </span>

      <span className={styles.folderFront}>
        <span className={styles.paperLabel}>
          <span
            className={[
              styles.folderName,
              longName ? styles.longName : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {item.name}
          </span>

          {item.description ? (
            <span className={styles.description}>{item.description}</span>
          ) : null}
        </span>

        <span className={styles.folderMeta}>
          <span className={styles.count}>{countLabel(item.serviceCount)}</span>

          <span className={styles.openHint}>
            {selected && center
              ? "Folder open"
              : center
                ? "Open folder"
                : "Bring forward"}

            <ArrowRight aria-hidden="true" />
          </span>
        </span>
      </span>
    </span>
  );
}

export function ServicesFolderCarousel({
  items,
  activeFolderId,
}: {
  items: ServicesFolderCarouselItem[];
  activeFolderId: string | null;
}) {
  const router = useRouter();
  const push = useRouteTransitionPush();

  const requestedIndex = activeFolderId
    ? items.findIndex((item) => item.id === activeFolderId)
    : -1;

  const [position, setPosition] = useState(
    requestedIndex >= 0 ? requestedIndex : 0,
  );

  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [motion, setMotion] = useState<MotionState | null>(null);

  const viewportRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const maxMovedRef = useRef(0);
  const suppressClickRef = useRef(false);
  const suppressTimerRef = useRef<number | null>(null);
  const prepareRafRef = useRef<number | null>(null);
  const recycleRafRef = useRef<number | null>(null);
  const wheelLockedUntilRef = useRef(0);
  const motionLockedRef = useRef(false);

  const idleOffsets = useMemo(
    () => servicesFolderVisibleOffsets(items.length),
    [items.length],
  );

  const renderOffsets = useMemo(() => {
    if (
      items.length < 3 ||
      !motion ||
      (motion.phase !== "prepare" && motion.phase !== "animating")
    ) {
      return idleOffsets;
    }

    return motion.direction > 0
      ? [-1, 0, 1, 2]
      : [-2, -1, 0, 1];
  }, [idleOffsets, items.length, motion]);

  const activeIndex = items.length
    ? wrapServicesFolderIndex(position, items.length)
    : 0;

  const activeItem = items[activeIndex] ?? null;

  useEffect(() => {
    if (
      requestedIndex < 0 ||
      items.length === 0 ||
      motionLockedRef.current
    ) {
      return;
    }

    setPosition((current) =>
      closestServicesFolderPosition(
        current,
        requestedIndex,
        items.length,
      ),
    );
  }, [items.length, requestedIndex]);

  useEffect(() => {
    if (!activeItem) return;
    router.prefetch(folderRoute(activeItem.id));
  }, [activeItem, router]);

  useEffect(() => {
    return () => {
      if (suppressTimerRef.current !== null) {
        window.clearTimeout(suppressTimerRef.current);
      }

      if (prepareRafRef.current !== null) {
        window.cancelAnimationFrame(prepareRafRef.current);
      }

      if (recycleRafRef.current !== null) {
        window.cancelAnimationFrame(recycleRafRef.current);
      }
    };
  }, []);

  function startNavigation(delta: number) {
    if (
      items.length <= 1 ||
      motionLockedRef.current ||
      !activeItem
    ) {
      return;
    }

    const direction: -1 | 1 = delta > 0 ? 1 : -1;

    motionLockedRef.current = true;

    setMotion({
      phase: "prepare",
      direction,
      outgoingId: activeItem.id,
    });

    if (prepareRafRef.current !== null) {
      window.cancelAnimationFrame(prepareRafRef.current);
    }

    prepareRafRef.current = window.requestAnimationFrame(() => {
      prepareRafRef.current = window.requestAnimationFrame(() => {
        setMotion({
          phase: "animating",
          direction,
          outgoingId: activeItem.id,
        });

        prepareRafRef.current = null;
      });
    });
  }

  function completePrimaryMotion(
    direction: -1 | 1,
    outgoingId: string,
  ) {
    setPosition((current) => current + direction);

    setMotion({
      phase: "recycle",
      direction,
      outgoingId,
    });

    if (recycleRafRef.current !== null) {
      window.cancelAnimationFrame(recycleRafRef.current);
    }

    recycleRafRef.current = window.requestAnimationFrame(() => {
      recycleRafRef.current = window.requestAnimationFrame(() => {
        setMotion({
          phase: "settling",
          direction,
          outgoingId,
        });

        recycleRafRef.current = null;
      });
    });
  }

  function finishSettling() {
    setMotion(null);
    motionLockedRef.current = false;
  }

  function openCenterFolder() {
    if (!activeItem || motionLockedRef.current) return;
    push(folderRoute(activeItem.id));
  }

  function handleFolderClick(offset: number) {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }

    if (motionLockedRef.current) return;

    if (offset === 0) {
      openCenterFolder();
      return;
    }

    startNavigation(offset);
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (
      items.length <= 1 ||
      event.button !== 0 ||
      motionLockedRef.current
    ) {
      return;
    }

    const now = event.timeStamp;

    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      lastX: event.clientX,
      lastAt: now,
      velocityX: 0,
    };

    maxMovedRef.current = 0;
    suppressClickRef.current = false;
    setDragging(true);

    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    const state = dragRef.current;

    if (!state || state.pointerId !== event.pointerId) {
      return;
    }

    const now = event.timeStamp;
    const elapsed = Math.max(1, now - state.lastAt);
    const frameDistance = event.clientX - state.lastX;
    const totalDistance = event.clientX - state.startX;

    state.velocityX = frameDistance / elapsed;
    state.lastX = event.clientX;
    state.lastAt = now;

    maxMovedRef.current = Math.max(
      maxMovedRef.current,
      Math.abs(totalDistance),
    );

    setDragX(totalDistance);
  }

  function finishPointer(event: PointerEvent<HTMLDivElement>) {
    const state = dragRef.current;

    if (!state || state.pointerId !== event.pointerId) {
      return;
    }

    const direction = servicesFolderDragDirection(
      dragX,
      state.velocityX,
      viewportRef.current?.clientWidth ?? 420,
    );

    const shouldSuppress =
      maxMovedRef.current >= CLICK_SUPPRESS_DISTANCE;

    suppressClickRef.current = shouldSuppress;

    if (suppressTimerRef.current !== null) {
      window.clearTimeout(suppressTimerRef.current);
    }

    if (shouldSuppress) {
      suppressTimerRef.current = window.setTimeout(() => {
        suppressClickRef.current = false;
        suppressTimerRef.current = null;
      }, 140);
    }

    dragRef.current = null;
    setDragging(false);
    setDragX(0);

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (direction !== 0) {
      startNavigation(direction);
    }
  }

  function cancelPointer(event: PointerEvent<HTMLDivElement>) {
    const state = dragRef.current;

    if (!state || state.pointerId !== event.pointerId) {
      return;
    }

    dragRef.current = null;
    maxMovedRef.current = 0;
    suppressClickRef.current = false;
    setDragging(false);
    setDragX(0);

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function handleWheel(event: WheelEvent<HTMLDivElement>) {
    if (items.length <= 1 || motionLockedRef.current) return;

    const horizontal =
      Math.abs(event.deltaX) > Math.abs(event.deltaY);

    const delta = horizontal ? event.deltaX : event.deltaY;

    if (Math.abs(delta) < 8) return;

    event.preventDefault();

    const now = event.timeStamp;

    if (now < wheelLockedUntilRef.current) {
      return;
    }

    wheelLockedUntilRef.current = now + WHEEL_LOCK_MS;

    startNavigation(delta > 0 ? 1 : -1);
  }

  function handleKeyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (motionLockedRef.current) return;

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      startNavigation(-1);
      return;
    }

    if (event.key === "ArrowRight") {
      event.preventDefault();
      startNavigation(1);
      return;
    }

    if (
      (event.key === "Enter" || event.key === " ") &&
      event.target === event.currentTarget
    ) {
      event.preventDefault();
      openCenterFolder();
    }
  }

  function handleFolderTransitionEnd(
    event: TransitionEvent<HTMLButtonElement>,
    offset: number,
    itemId: string,
  ) {
    if (
      event.target !== event.currentTarget ||
      event.propertyName !== "transform" ||
      !motion
    ) {
      return;
    }

    if (
      motion.phase === "animating" &&
      offset === 0 &&
      itemId === motion.outgoingId
    ) {
      completePrimaryMotion(
        motion.direction,
        motion.outgoingId,
      );
      return;
    }

    if (
      motion.phase === "settling" &&
      itemId === motion.outgoingId
    ) {
      finishSettling();
    }
  }

  if (items.length === 0) {
    return <div className={styles.empty}>No service folders exist yet.</div>;
  }

  if (items.length === 1) {
    const item = items[0]!;

    return (
      <div className={styles.singleStage}>
        <button
          type="button"
          className={[
            styles.folder,
            styles.centerFolder,
            styles.singleFolder,
          ].join(" ")}
          onClick={() => push(folderRoute(item.id))}
          aria-label={`Open ${item.name}, ${countLabel(item.serviceCount)}`}
        >
          <FolderContents
            item={item}
            center={true}
            selected={activeFolderId === item.id}
          />
        </button>
      </div>
    );
  }

  return (
    <div className={styles.shell}>
      <div
        ref={viewportRef}
        className={[
          styles.viewport,
          dragging ? styles.dragging : "",
        ]
          .filter(Boolean)
          .join(" ")}
        role="region"
        aria-roledescription="carousel"
        aria-label="Service folders"
        tabIndex={0}
        onKeyDown={handleKeyboard}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishPointer}
        onPointerCancel={cancelPointer}
        onWheel={handleWheel}
      >
        <div className={styles.stage}>
          {renderOffsets.map((offset) => {
            const virtualIndex = position + offset;

            const realIndex = wrapServicesFolderIndex(
              virtualIndex,
              items.length,
            );

            const item = items[realIndex]!;

            const visual = motionVisual(
              offset,
              item.id,
              motion,
            );

            const center = offset === 0;
            const adjacent = Math.abs(offset) <= 1;
            const selected = item.id === activeFolderId;

            const isOutgoing =
              motion?.phase === "animating" &&
              offset === 0;

            const isIncoming =
              motion?.phase === "animating" &&
              offset === motion.direction;

            const isTrailing =
              motion?.phase === "animating" &&
              offset === -motion.direction;

            const isUpcoming =
              motion?.phase === "animating" &&
              offset === motion.direction * 2;

            const isRecycleHold =
              motion?.phase === "recycle" &&
              item.id === motion.outgoingId;

            const isSettlingOutgoing =
              motion?.phase === "settling" &&
              item.id === motion.outgoingId;

            const inlineStyle = {
              "--wf-folder-x": visual.x,
              "--wf-folder-y": visual.y,
              "--wf-folder-drag": `${dragX}px`,
              "--wf-folder-scale": String(visual.scale),
              "--wf-folder-rotate": visual.rotate,
              "--wf-folder-opacity": String(visual.opacity),
              "--wf-folder-z": String(visual.zIndex),
            } as CSSProperties;

            return (
              <button
                type="button"
                key={virtualIndex}
                className={[
                  styles.folder,
                  center ? styles.centerFolder : styles.sideFolder,
                  offset < 0 ? styles.leftFolder : "",
                  offset > 0 ? styles.rightFolder : "",
                  selected ? styles.selectedFolder : "",
                  isOutgoing ? styles.motionOutgoing : "",
                  isIncoming ? styles.motionIncoming : "",
                  isTrailing ? styles.motionTrailing : "",
                  isUpcoming ? styles.motionUpcoming : "",
                  isRecycleHold ? styles.motionRecycleHold : "",
                  isSettlingOutgoing ? styles.motionSettlingOutgoing : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                style={inlineStyle}
                onClick={() => handleFolderClick(offset)}
                onTransitionEnd={(event) =>
                  handleFolderTransitionEnd(
                    event,
                    offset,
                    item.id,
                  )
                }
                tabIndex={adjacent ? 0 : -1}
                aria-current={
                  center && selected ? "true" : undefined
                }
                aria-label={
                  center
                    ? `Open ${item.name}, ${countLabel(item.serviceCount)}`
                    : `Bring ${item.name} to the center, ${countLabel(item.serviceCount)}`
                }
              >
                <FolderContents
                  item={item}
                  center={center}
                  selected={selected}
                />
              </button>
            );
          })}
        </div>

        <span className={styles.srStatus} aria-live="polite">
          {activeItem
            ? `${activeItem.name}, ${countLabel(activeItem.serviceCount)}, folder ${activeIndex + 1} of ${items.length}`
            : ""}
        </span>
      </div>
    </div>
  );
}