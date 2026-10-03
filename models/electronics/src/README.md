# electronics models

Circuit boards, the case one lives in and a cable it drives, as one cad-project. Every script
directly under `src/` is runnable; its outputs land in format folders at the project root
(`PCB/`, `STEP/`, `GLB/`, `HARNESS/`). The `src/` tree is committed; build the outputs you need.

```bash
python models/electronics/src/servo_power.py    # the board: KiCad project, fab files, 3D
python models/electronics/src/servo_case.py     # the case, with the board in it
python models/electronics/src/servo_cable.py    # the cable, from the board's netlist
python models/electronics/src/bus_servo_hat.py  # a Raspberry Pi HAT: KiCad project, fab files, STEP + GLB
```

The board needs KiCad 10 and Freerouting (`$pcb`); the cable's drawing needs WireViz and
Graphviz (`$harness`).

| Script | Artifact | Description |
|--------|----------|-------------|
| `servo_power.py` | `PCB/servo_power.kicad_{pro,sch,pcb,dru}`, `PCB/servo_power.{gerbers.zip,bom.csv,pos.csv}`, `STEP/servo_power.step` | USB-C servo power board: 5 V through a polyfuse to three servo headers, an AMS1117 for 3.3 V logic, autorouted over two ground pours, JLCPCB rules |
| `servo_case.py` | `STEP/servo_case.step` | Open-top printed case: the board on four standoffs, its USB-C port through the left wall |
| `servo_cable.py` | `HARNESS/servo_cable.harness.yml` | Servo extension from the board's J2 header to a servo's three-wire lead |
| `bus_servo_hat.py` | `PCB/bus_servo_hat.kicad_{pro,sch,pcb,dru}`, `PCB/bus_servo_hat.{gerbers.zip,bom.csv,pos.csv}`, `STEP/bus_servo_hat.step`, `GLB/bus_servo_hat.glb` | Raspberry Pi HAT for serial bus servos (a version of Waveshare's Bus Servo Adapter (A)): 9-12.6 V in on a barrel jack or a reverse-protected terminal, four servo ports, a 5 V / 5 A buck that powers the Pi through an ideal diode, and the auto-direction half-duplex bus from the Pi's UART or USB-C (CH343P) |
