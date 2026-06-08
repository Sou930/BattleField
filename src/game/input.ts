export interface MoveVec {
  x: number;
  y: number;
}

export class Input {
  keys = new Set<string>();
  mouse = { dx: 0, dy: 0, left: false, right: false };
  touchMove: MoveVec = { x: 0, y: 0 };
  touchLook = { dx: 0, dy: 0 };
  touchActive = false;
  jumpPressed = false;
  reloadPressed = false;
  pickupPressed = false;
  weaponSwitchPressed: number | null = null;
  locked = false;
  // Vehicle-specific touch controls
  vehicleGas = false;
  vehicleBrake = false;
  enterVehiclePressed = false;
  mapTogglePressed = false;
  aircraftEnterPressed = false;
  // 乗り物搭乗中の視点切り替え (V): 三人称 ⇔ 一人称
  viewTogglePressed = false;
  // 航空機: エアブレーキ (押している間ON / モバイルはホールド)
  aircraftAirbrake = false;
  // 航空機: ランディングギア(脚)の出し入れトグル
  gearTogglePressed = false;

  // === War Thunder Mobile 風 飛行操作 (モバイル用) =======================
  // 操縦スティック: x = ロール/旋回 (-1..1), y = ピッチ (-1..1, 下に倒す=機首下げ)。
  // タッチでスティックを操作している間 flightStickActive=true。離すと中立(0,0)へ。
  flightStick: MoveVec = { x: 0, y: 0 };
  flightStickActive = false;
  // スロットルスライダー: 0..1 の絶対値。null のときはスライダー未使用
  // (キーボード W/S による相対操作にフォールバック)。
  flightThrottle: number | null = null;

  private el: HTMLElement;
  private onKey = (e: KeyboardEvent, down: boolean) => {
    if (down) this.keys.add(e.code);
    else this.keys.delete(e.code);
    if (down && e.code === "KeyE") this.pickupPressed = true;
    if (down && e.code === "KeyM") this.mapTogglePressed = true;
    if (down && e.code === "KeyG") this.aircraftEnterPressed = true;
    if (down && e.code === "KeyV") this.viewTogglePressed = true;
    // 航空機: ランディングギア(脚) トグル (KeyF はキー押下の瞬間だけ反応)
    if (down && e.code === "KeyF") this.gearTogglePressed = true;
    // 航空機: エアブレーキ (Shift / B を押している間ON)
    if (e.code === "ShiftLeft" || e.code === "ShiftRight" || e.code === "KeyB")
      this.aircraftAirbrake = down;
  };
  private onMove = (e: MouseEvent) => {
    if (!this.locked) return;
    this.mouse.dx += e.movementX;
    this.mouse.dy += e.movementY;
  };
  private onMouseDown = (e: MouseEvent) => {
    if (!this.locked) return;
    if (e.button === 0) this.mouse.left = true;
    if (e.button === 2) this.mouse.right = true;
  };
  private onMouseUp = (e: MouseEvent) => {
    if (e.button === 0) this.mouse.left = false;
    if (e.button === 2) this.mouse.right = false;
  };
  private onLockChange = () => {
    this.locked = document.pointerLockElement === this.el;
  };
  constructor(el: HTMLElement) {
    this.el = el;
    window.addEventListener("keydown", (e) => this.onKey(e, true));
    window.addEventListener("keyup", (e) => this.onKey(e, false));
    window.addEventListener("mousemove", this.onMove);
    window.addEventListener("mousedown", this.onMouseDown);
    window.addEventListener("mouseup", this.onMouseUp);
    document.addEventListener("pointerlockchange", this.onLockChange);
    el.addEventListener("contextmenu", (e) => e.preventDefault());
  }
  requestLock() {
    this.el.requestPointerLock?.();
  }
  consumeMouseDelta() {
    const d = {
      dx: this.mouse.dx + this.touchLook.dx,
      dy: this.mouse.dy + this.touchLook.dy,
    };
    this.mouse.dx = 0;
    this.mouse.dy = 0;
    this.touchLook.dx = 0;
    this.touchLook.dy = 0;
    return d;
  }
  setTouchMove(v: MoveVec) {
    this.touchMove = v;
    this.touchActive = true;
  }
  addTouchLook(dx: number, dy: number) {
    this.touchLook.dx += dx;
    this.touchLook.dy += dy;
    this.touchActive = true;
  }
  setFire(on: boolean) {
    this.mouse.left = on;
  }
  setAim(on: boolean) {
    this.mouse.right = on;
  }
  pressJump() { this.jumpPressed = true; }
  pressReload() { this.reloadPressed = true; }
  pressPickup() { this.pickupPressed = true; }
  pressSwitchWeapon(n: number) { this.weaponSwitchPressed = n; }
  pressEnterVehicle() { this.enterVehiclePressed = true; }
  pressAircraftEnter() { this.aircraftEnterPressed = true; }
  pressMapToggle() { this.mapTogglePressed = true; }
  pressViewToggle() { this.viewTogglePressed = true; }
  setVehicleGas(on: boolean) { this.vehicleGas = on; }
  setVehicleBrake(on: boolean) { this.vehicleBrake = on; }
  // 航空機補助操作 (モバイル用)
  setAircraftAirbrake(on: boolean) { this.aircraftAirbrake = on; }
  pressGearToggle() { this.gearTogglePressed = true; }
  // War Thunder Mobile 風: 操縦スティック & スロットルスライダー
  setFlightStick(v: MoveVec) { this.flightStick = v; this.flightStickActive = true; }
  releaseFlightStick() { this.flightStick = { x: 0, y: 0 }; this.flightStickActive = false; }
  setFlightThrottle(t: number) { this.flightThrottle = Math.max(0, Math.min(1, t)); }
}
