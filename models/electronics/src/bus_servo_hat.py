"""Bus servo HAT: a Raspberry Pi HAT that drives serial bus servos and powers the Pi from their supply.

A version of Waveshare's Bus Servo Adapter (A) on the Pi's HAT outline. 9-12.6 V comes in on a
barrel jack, or on a screw terminal behind a reverse-polarity P-FET, and goes straight to four
servo ports. A 5 V / 5 A buck powers the Pi through its 5V header pins, behind an ideal diode
so a Pi powered from its own USB-C never back-feeds the servo supply. The servo bus is
half-duplex on one wire: while the host's TX is low a PNP enables a 74LVC1G126 that pulls DATA
low and disables the 74LVC1G125 that passes DATA back to the host's RX, so no direction pin is
needed. The host is the Pi's UART (GPIO14/15) or the 3-pin UART header with the jumpers on A,
or a PC over USB-C through a CH343P with the jumpers on B.
"""

from cadgen import build123d as bd
from cadgen import glb, pcb, step

# The Pi HAT outline (KiCad's RaspberryPi-HAT template): 65 x 56 mm, 3 mm corners, M2.5 holes
# on the Pi's 58 x 49 mm pattern, the display-cable notch and the camera-cable slot.
WIDTH, HEIGHT, CORNER = 65.0, 56.0, 3.0
HOLES = [(3.5, 3.5), (61.5, 3.5), (3.5, 52.5), (61.5, 52.5)]
PI_PIN1 = (8.37, 51.23)  # the 40-pin socket, on the underside

R_0603 = "Resistor_SMD:R_0603_1608Metric"
C_0603 = "Capacitor_SMD:C_0603_1608Metric"
C_0805 = "Capacitor_SMD:C_0805_2012Metric"
C_1206 = "Capacitor_SMD:C_1206_3216Metric"
SOD_323 = "Diode_SMD:D_SOD-323"
SOT_23_5 = "Package_TO_SOT_SMD:SOT-23-5"


def outline():
    with bd.BuildSketch() as sketch:
        with bd.Locations((WIDTH / 2, HEIGHT / 2)):
            bd.RectangleRounded(WIDTH, HEIGHT, CORNER)
        with bd.Locations((2.0, 28.0)):  # display-cable notch: x 0..5, y 19.5..36.5
            bd.Rectangle(6.0, 17.0, mode=bd.Mode.SUBTRACT)
        with bd.Locations((45.0, 11.5)):  # camera-cable slot: x 44..46, y 3..20
            bd.SlotCenterToCenter(15.0, 2.0, rotation=90, mode=bd.Mode.SUBTRACT)
    return sketch.sketch


def resistor(board, value, at, rotation=0):
    r = board.part("Device:R", footprint=R_0603, value=value)
    board.place(r, at=at, rotation=rotation)
    return r


def capacitor(board, value, at, rotation=0, footprint=C_0603):
    c = board.part("Device:C", footprint=footprint, value=value)
    board.place(c, at=at, rotation=rotation)
    return c


def schottky(board, at, rotation=0):
    d = board.part("Device:D_Schottky", footprint=SOD_323, value="B5819WS", properties={"MPN": "B5819WS"})
    board.place(d, at=at, rotation=rotation)
    return d


def power_input(board, vin, gnd):
    """The barrel jack straight onto VIN; the screw terminal through a P-FET that blocks reversed wires."""
    vin_raw, gate = board.net("VIN_RAW"), board.net("GATE")
    jack = board.part("Connector:Barrel_Jack_Switch", footprint="Connector_BarrelJack:BarrelJack_Horizontal",
                      value="DC 5.5x2.1", ref="J2")
    terminal = board.part("Connector:Screw_Terminal_01x02", ref="J3", value="KF350-2P",
                          footprint="TerminalBlock_Phoenix:TerminalBlock_Phoenix_PT-1,5-2-3.5-H_1x02_P3.50mm_Horizontal")
    # AO4407A (-30 V, 12 A, 14 mOhm at -6 V) in the FDS9435A's SO-8 pinout: S 1-3, G 4, D 5-8.
    fet = board.part("Transistor_FET:FDS9435A", value="AO4407A", properties={"MPN": "AO4407A"})
    zener = board.part("Device:D_Zener", footprint=SOD_323, value="BZT52C6V8S", properties={"MPN": "BZT52C6V8S"})
    tvs = board.part("Device:D_TVS", footprint="Diode_SMD:D_SMA", value="SMAJ15CA", properties={"MPN": "SMAJ15CA"})
    bulk = board.part("Device:C_Polarized", footprint="Capacitor_SMD:CP_Elec_8x10", value="220u 25V")
    board.connect(vin, jack[1], *[fet[n] for n in ("1", "2", "3")], zener["K"], tvs[1], bulk[1])
    board.connect(gnd, jack[2], jack[3], terminal[1], tvs[2], bulk[2])
    board.connect(vin_raw, terminal[2], *[fet[n] for n in ("5", "6", "7", "8")])
    board.connect(gate, fet["4"], zener["A"])

    board.place(jack, at=(14.0, 13.5))  # mouth on the left edge, below the display notch
    board.place(terminal, at=(19.0, 4.5))  # wires in from the bottom edge
    board.place(fet, at=(29.0, 5.5), rotation=180)  # drains face the terminal
    board.place(zener, at=(34.2, 6.5), rotation=90)
    r_gate = resistor(board, "2k", at=(34.2, 10.0), rotation=90)
    board.connect(gate, r_gate[1])
    board.connect(gnd, r_gate[2])
    board.place(tvs, at=(39.5, 4.8))
    board.place(bulk, at=(39.5, 12.6), rotation=-90)  # + at the top, toward the servo trunk
    # Each SO-8 pin row is one net: join its pads at pad width, clear of the gate pad.
    board.track(vin_raw, [fet["8"], fet["5"]], width=0.6)
    board.track(vin, [fet["1"], fet["3"]], width=0.6)
    # The servos' current, by hand: the jack to the bulk capacitor, 2 mm wide (the buck's input
    # branches off at x = 20); the terminal through the FET, past the TVS, to the same capacitor.
    board.track(vin, [jack[1], (16.0, 13.5), (18.35, 15.85), (20.025, 15.85), bulk[1]], width=2.0)
    board.track(vin_raw, [terminal[2], (24.5, 4.5), fet["7"]], width=1.5)
    board.track(vin, [fet["1"], (35.9, 3.595), tvs[1], (36.2, 6.1), (36.2, 14.6), bulk[1]], width=1.5)
    return bulk


def buck(board, vin, v5, gnd):
    """TPS565208, 5 A: VOUT = 0.76 V x (1 + 57.6k / 10k) = 5.14 V; EN divider starts it above 6.6 V."""
    sw, bst, fb, en = board.net("SW"), board.net("BST"), board.net("FB"), board.net("EN")
    u = board.part("Regulator_Switching:TPS565208", value="TPS565208", properties={"MPN": "TPS565208DDCR"})
    inductor = board.part("Device:L", footprint="Inductor_SMD:L_Bourns_SRP7028A_7.3x6.6mm", value="3.3u",
                          properties={"MPN": "SRP7028A-3R3M"})
    board.place(u, at=(20.0, 28.0))
    board.place(inductor, at=(11.5, 28.0), rotation=180)  # pin 1 (SW) faces the IC's SW pin
    c_hf = capacitor(board, "100n", at=(17.5, 24.4), rotation=180)
    c_in = [capacitor(board, "10u 25V", at=(21.5, y), footprint=C_1206) for y in (23.0, 20.3)]
    c_out = [capacitor(board, "22u 10V", at=(x, 34.2), rotation=90, footprint=C_1206) for x in (8.5, 11.0)]
    c_bst = capacitor(board, "100n", at=(20.0, 31.0))
    # EN divider beside the input capacitors, where VIN is; EN runs from there to its pin.
    r_en_top, r_en_bot = resistor(board, "100k", (17.6, 19.0), 180), resistor(board, "22k", (14.6, 19.0), 180)
    r_fb_top, r_fb_bot = resistor(board, "57.6k", (25.0, 25.5), 90), resistor(board, "10k", (27.0, 25.5), 90)

    board.connect(vin, u["VIN"], c_hf[1], c_in[0][1], c_in[1][1], r_en_top[1])
    board.connect(gnd, u["GND"], c_hf[2], c_in[0][2], c_in[1][2], c_out[0][2], c_out[1][2], r_en_bot[2], r_fb_bot[2])
    board.connect(en, u["EN"], r_en_top[2], r_en_bot[1])
    board.connect(sw, u["SW"], inductor[1], c_bst[1])
    board.connect(bst, u["VBST"], c_bst[2])
    board.connect(v5, inductor[2], c_out[0][1], c_out[1][1], r_fb_top[1])
    board.connect(fb, u["VFB"], r_fb_top[2], r_fb_bot[1])

    # The switch node by hand: out of the pad at its width, then short and wide to the inductor,
    # and round the GND pin to the boost capacitor.
    x, y = u["SW"].position
    board.track(sw, [u["SW"], (x - 1.8, y)], width=0.6)
    board.track(sw, [(x - 1.8, y), inductor[1]], width=1.5)
    board.track(sw, [(x - 1.8, y), (x - 1.8, 31.0), c_bst[1]], width=0.4)
    # The input loop: from the jack's track up through both input capacitors to the VIN pin.
    x, y = u["VIN"].position
    board.track(vin, [u["VIN"], (x, y - 1.4)], width=0.6)
    board.track(vin, [(20.025, 15.85), (20.025, 19.0), c_in[1][1], c_in[0][1], c_hf[1], (x, y - 1.4)], width=1.0)
    board.track(vin, [(20.025, 19.0), r_en_top[1]], width=0.4)
    board.track(en, [r_en_top[2], r_en_bot[1]], width=0.3)
    return inductor, c_out


def ideal_diode(board, v5, v5_pi, gnd):
    """The buck's 5 V to the Pi's 5V pins through a P-FET that turns off when the Pi's side is higher.

    Raspberry Pi's own back-powering circuit: a PNP pair compares the two sides; while the
    buck's side is higher the gate is pulled low (FET on), and the moment the Pi's side is
    higher (the Pi on its own USB-C, the servo supply off) the second PNP pulls the gate up.
    """
    gate, ref = board.net("PI_GATE"), board.net("PI_REF")
    fet = board.part("Transistor_FET:AON6411", value="AON6411", properties={"MPN": "AON6411"})
    pair = board.part("Transistor_BJT:MMDT3906", value="MMDT3906", properties={"MPN": "MMDT3906-7-F"})
    board.place(fet, at=(11.5, 43.0), rotation=-90)  # drain pads face the buck, sources the Pi
    board.place(pair, at=(16.5, 44.0))
    r_ref, r_gate = resistor(board, "47k", (20.0, 45.0)), resistor(board, "10k", (20.0, 43.0))
    board.connect(v5, fet["D"], pair["E1"])
    board.connect(v5_pi, *[fet[n] for n in ("1", "2", "3")], pair["E2"])
    board.connect(ref, pair["B1"], pair["C1"], pair["B2"], r_ref[1])
    board.connect(gate, fet["G"], pair["C2"], r_gate[1])
    board.connect(gnd, r_ref[2], r_gate[2])
    board.track(v5_pi, [fet["3"], fet["1"]], width=0.6)
    return fet


def logic_supply(board, v5, vbus, v3, gnd):
    """3.3 V for the logic from whichever is up, the buck's 5 V or USB's, as the original does."""
    ldo_in = board.net("LDO_IN", power_flag=True)  # fed through the OR-ing diodes
    ldo = board.part("Regulator_Linear:AMS1117-3.3", value="AMS1117-3.3")
    board.place(ldo, at=(31.0, 43.5))
    d_5v, d_usb = schottky(board, (16.0, 38.5), 180), schottky(board, (23.5, 37.8), 180)
    c_in = capacitor(board, "10u", at=(27.0, 38.0), footprint=C_0805)
    c_out = capacitor(board, "22u", at=(37.5, 44.0), rotation=90, footprint=C_0805)
    board.connect(v5, d_5v["A"])
    board.connect(vbus, d_usb["A"])
    board.connect(ldo_in, d_5v["K"], d_usb["K"], ldo["VI"], c_in[1])
    board.connect(v3, ldo["VO"], c_out[1])
    board.connect(gnd, ldo["GND"], c_in[2], c_out[2])
    led = board.part("Device:LED", footprint="LED_SMD:LED_0603_1608Metric", value="red")
    board.place(led, at=(43.5, 47.5))
    r_led = resistor(board, "1k", (40.0, 47.5))
    board.connect(v3, r_led[1])
    board.connect(board.net(), r_led[2], led["A"])
    board.connect(gnd, led["K"])
    return ldo_in, d_5v


def usb_bridge(board, ldo_in, vbus, v3, gnd, ch_txd, ch_rxd):
    """USB-C to a CH343P. Its core runs from LDO_IN (5 V mode, V3 its own regulator's output),
    its I/O at 3.3 V, so it is powered whenever the board is."""
    usb = board.part("Connector:USB_C_Receptacle_USB2.0_16P", ref="J4", value="USB-C",
                     footprint="Connector_USB:USB_C_Receptacle_GCT_USB4105-xx-A_16P_TopMnt_Horizontal",
                     properties={"MPN": "USB4105-GF-A"})
    bridge = board.part("Interface_USB:CH343P", value="CH343P", properties={"MPN": "CH343P"})
    board.place(usb, at=(52.3, 3.675))  # its PCB-edge line on the bottom edge
    board.place(bridge, at=(51.8, 14.0))
    dp, dn, v3_core = board.net("USB_DP"), board.net("USB_DN"), board.net("CH_V3")
    for pin in usb.pins():
        if pin.name == "GND":
            board.connect(gnd, pin)
        elif pin.name == "VBUS":
            board.connect(vbus, pin)
        elif pin.name == "D+":
            board.connect(dp, pin)
        elif pin.name == "D-":
            board.connect(dn, pin)
    r_cc1, r_cc2 = resistor(board, "5.1k", (48.0, 10.2), 90), resistor(board, "5.1k", (55.2, 10.5), 90)
    board.connect(board.net("CC1"), usb["CC1"], r_cc1[1])
    board.connect(board.net("CC2"), usb["CC2"], r_cc2[1])
    board.connect(gnd, r_cc1[2], r_cc2[2], usb["SHIELD"])
    board.no_connect(*usb.unconnected())

    c_vbus = capacitor(board, "10u", at=(55.2, 14.5), rotation=90, footprint=C_0805)
    c_vdd5 = capacitor(board, "1u", at=(48.5, 15.0), rotation=90)
    c_vio = capacitor(board, "1u", at=(48.5, 18.0), rotation=90)
    c_v3 = capacitor(board, "100n", at=(50.6, 10.6), rotation=-90, footprint="Capacitor_SMD:C_0402_1005Metric")
    board.connect(vbus, bridge["VBUS"], c_vbus[1])
    board.connect(ldo_in, bridge["VDD5"], c_vdd5[1])
    board.connect(v3_core, bridge["V3_{OUT}"], c_v3[1])
    board.connect(v3, bridge["VIO"], c_vio[1])
    board.connect(gnd, bridge["GND"], bridge["GND_EPAD"], c_vbus[2], c_vdd5[2], c_vio[2], c_v3[2])
    # The receptacle's GND pads sit in its fine-pitch row: tie each to the shell's through-hole tab.
    x0, y0 = usb.at
    board.track(gnd, [usb["A1"], (x0 - 4.32, y0 + 3.105)], width=0.3)
    board.track(gnd, [usb["A12"], (x0 + 4.32, y0 + 3.105)], width=0.3)
    board.connect(dp, bridge["UD+"])
    board.connect(dn, bridge["UD-"])
    board.connect(ch_txd, bridge["TXD"])
    board.connect(ch_rxd, bridge["RXD"])
    board.no_connect(*bridge.unconnected())
    # GCT's land pattern puts the receptacle's GND pads 0.19 mm from its own locating pegs.
    board.rule("""(rule "J4 land pattern" (constraint hole_clearance (min 0.15mm))
        (condition "A.memberOfFootprint('J4') && B.memberOfFootprint('J4')"))""")


def half_duplex(board, v3, gnd, u1txd, u1rxd, data):
    """The auto-direction switch: TX low -> PNP on -> TXEN high -> '126 drives DATA, '125 off."""
    txen, base = board.net("TXEN"), board.net("BASE")
    q = board.part("Transistor_BJT:MMBT3906", value="MMBT3906", properties={"MPN": "MMBT3906LT1G"})
    drive = board.part("74xGxx:74LVC1G126", footprint=SOT_23_5, value="74LVC1G126",
                       properties={"MPN": "SN74LVC1G126DBVR"})
    listen = board.part("74xGxx:74LVC1G125", footprint=SOT_23_5, value="74LVC1G125",
                        properties={"MPN": "SN74LVC1G125DBVR"})
    board.place(q, at=(52.0, 36.0))
    board.place(drive, at=(52.0, 30.0))
    board.place(listen, at=(52.0, 24.5))
    r_txpu, r_base = resistor(board, "10k", (48.0, 36.0), 90), resistor(board, "10k", (48.0, 39.5), 90)
    r_txen = resistor(board, "20k", (55.5, 36.0), 90)
    r_data, r_rxpu = resistor(board, "10k", (55.5, 30.0), 90), resistor(board, "10k", (55.5, 24.5), 90)
    c_drive, c_listen = capacitor(board, "100n", (48.0, 30.0), 90), capacitor(board, "100n", (48.0, 24.5), 90)
    c_bulk = capacitor(board, "1u", (48.0, 43.0), 90)
    clamp = schottky(board, (55.5, 41.0), 90)
    board.connect(v3, q["E"], r_txpu[1], r_data[1], r_rxpu[1], drive["VCC"], listen["VCC"],
                  c_drive[1], c_listen[1], c_bulk[1])
    board.connect(u1txd, r_txpu[2], r_base[1], drive["2"])
    board.connect(base, r_base[2], q["B"])
    board.connect(txen, q["C"], r_txen[1], drive["1"], listen["1"])
    board.connect(data, drive["4"], r_data[2], listen["2"], clamp["K"])
    board.connect(u1rxd, listen["4"], r_rxpu[2])
    board.connect(gnd, r_txen[2], drive["GND"], listen["GND"], c_drive[2], c_listen[2], c_bulk[2], clamp["A"])
    x, y = listen["GND"].position
    board.track(gnd, [listen["GND"], (x - 1.2, y)], width=0.3)  # into the pour: routes crowd its spokes


@glb(out="../GLB/bus_servo_hat.glb")
@step(out="../STEP/bus_servo_hat.step")
@pcb(out="../PCB/bus_servo_hat.kicad_pcb", gerber=True, bom=True, pos=True)
def bus_servo_hat():
    board = pcb.Board(outline=outline(), fab=pcb.JLCPCB, title="Bus servo HAT")
    vin = board.net("VIN", power_flag=True)  # the servo supply, 9-12.6 V; its current paths are drawn
    v5 = board.net("+5V")  # the buck's output; its current path is drawn by hand below
    v5_pi = board.net("5V_PI")  # the Pi's 5V pins (its symbol's pin 2 drives it), drawn by hand too
    v3, vbus, gnd = board.net("+3V3"), board.net("VBUS"), board.net("GND")  # the Pi's GND pin 6 drives GND
    data = board.net("DATA")
    txd, rxd = board.net("TXD"), board.net("RXD")  # the host's TX and RX
    u1txd, u1rxd = board.net("U1TXD"), board.net("U1RXD")  # the bus side
    ch_txd, ch_rxd = board.net("CH_TXD"), board.net("CH_RXD")  # the USB bridge's side

    bulk = power_input(board, vin, gnd)
    inductor, c_out = buck(board, vin, v5, gnd)
    pi_fet = ideal_diode(board, v5, v5_pi, gnd)
    ldo_in, d_5v = logic_supply(board, v5, vbus, v3, gnd)
    usb_bridge(board, ldo_in, vbus, v3, gnd, ch_txd, ch_rxd)
    half_duplex(board, v3, gnd, u1txd, u1rxd, data)

    # The Pi: 5 V in on pins 2 and 4, its UART on GPIO14/15, nothing else.
    pi = board.part("Connector:Raspberry_Pi_4", ref="J1", value="Raspberry Pi GPIO",
                    footprint="Connector_PinSocket_2.54mm:PinSocket_2x20_P2.54mm_Vertical")
    board.connect(v5_pi, pi["2"], pi["4"])
    board.connect(gnd, *[pin for pin in pi.pins() if pin.name == "GND"])
    board.connect(txd, pi["GPIO14/UART_TXD"])
    board.connect(rxd, pi["GPIO15/UART_RXD"])
    board.no_connect(*pi.unconnected())
    board.place(pi, at=PI_PIN1, rotation=-90, side="bottom")  # pin 2 above pin 1, pin 3 right of it

    # Host select: jumpers on 1-3 and 2-4 = A (the Pi, or the UART header), on 3-5 and 4-6 = B (USB).
    jumpers = board.part("Connector_Generic:Conn_02x03_Odd_Even", ref="J9", value="HOST A|B",
                         footprint="Connector_PinHeader_2.54mm:PinHeader_2x03_P2.54mm_Vertical")
    for pin, net in zip(range(1, 7), (rxd, txd, u1rxd, u1txd, ch_rxd, ch_txd)):
        board.connect(net, jumpers[pin])
    board.place(jumpers, at=(38.0, 30.0))
    uart = board.part("Connector_Generic:Conn_01x03", ref="J10", value="UART",
                      footprint="Connector_PinHeader_2.54mm:PinHeader_1x03_P2.54mm_Vertical")
    board.connect(gnd, uart[1])
    board.connect(rxd, uart[2])
    board.connect(txd, uart[3])
    board.place(uart, at=(38.0, 34.5), rotation=90)

    # Four servo ports down the right edge, pin 1 DATA, 2 VIN, 3 GND as the original.
    ports = []
    for index, y in enumerate((9.0, 19.95, 30.9, 41.85)):
        port = board.part("Connector_Generic:Conn_01x03", ref=f"J{5 + index}", value="Servo",
                          footprint="Connector_JST:JST_XH_B3B-XH-A_1x03_P2.50mm_Vertical")
        board.connect(data, port[1])
        board.connect(vin, port[2])
        board.connect(gnd, port[3])
        board.place(port, at=(60.6, y), rotation=90)
        ports.append(port)

    # The servo trunk, 2 mm: up from the bulk capacitor, over the camera slot, down the ports.
    trunk = 57.6
    board.track(vin, [bulk[1], (39.5, 21.6), (trunk, 21.6)], width=2.0)
    stubs = [port[2].position[1] for port in ports]
    board.track(vin, [(trunk, y) for y in sorted({*stubs, 21.6})], width=2.0)
    for port in ports:
        board.track(vin, [(trunk, port[2].position[1]), port[2]], width=2.0)
    # The Pi's current, 1.5 mm: buck output -> the ideal diode's drain; 1.2 mm from its source
    # around the 3V3 pin (no room between header pins) to the Pi's 5V pins 2 and 4.
    board.track(v5, [inductor[2], c_out[0][1], c_out[1][1], (13.4, 32.725), (13.4, 38.5), (13.4, 40.2)], width=1.5)
    board.track(v5, [(13.4, 38.5), d_5v["A"]], width=0.5)
    board.track(v5_pi, [pi_fet["2"], (12.135, 48.5), (6.2, 48.5), (6.2, 53.77), pi["2"], pi["4"]], width=1.2)

    for at in HOLES:
        board.hole(at=at, diameter=2.75)
    board.zone(gnd, layers=["F.Cu"])
    board.zone(gnd, layers=["B.Cu"], pads="solid")  # header pins: the routes leave no room for 2 spokes
    board.text("BUS SERVO HAT", at=(30.0, 20.5), size=1.2)
    board.autoroute()
    return board


if __name__ == "__main__":
    bus_servo_hat()
