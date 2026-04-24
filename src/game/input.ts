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

  private el: HTMLElement;
  private onKey = (e: KeyboardEvent, down: boolean) => {
    if (down) this.keys.add(e.code);
    else this.keys.delete(e.code);
    if (down && e.code === "KeyE") this.pickupPressed = true;
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
  setVehicleGas(on: boolean) { this.vehicleGas = on; }
  setVehicleBrake(on: boolean) { this.vehicleBrake = on; }
}
