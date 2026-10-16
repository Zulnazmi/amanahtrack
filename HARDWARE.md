# HARDWARE.md: turning your donation box into an input channel

What this gives you: every time coins drop into the tray, the Pi weighs the change,
works out the most likely coin combination, and sends a **provisional** estimate to
AmanahTrack. The app shows it as "estimated, not yet counted". When the treasurer and
a witness empty the box and enter the real count, the estimates are marked confirmed
and the difference between the counted total and the estimates is posted as a visible
"count adjustment" entry (this is also how banknotes enter the books).

The box never writes the balance. It only has an opinion. That is the design.

## 1. What this can and cannot do (read this first)

| Situation | What happens |
|---|---|
| Coins that weigh different from every other coin (5, 10 sen, old 50 sen) | Value is exact, confidence about 1.0 |
| Old 20 sen and new 50 sen (both 5.66 g) | Cannot be told apart by weight. Script reports an expected value between them, confidence about 0.6 |
| Several coins dropped together | Script searches combinations of up to 5 coins and reports the likeliest, lower confidence |
| Banknotes | Not measured. Weight is too small and too variable. The event is logged as `unexplained_weight` and the note stays uncounted until the witnessed count |
| Someone steals from the tray | Large weight drop is logged as `tray_emptied` and the app expects a count session |

So the sensor gives a **running estimate of coin money**, not the whole total. In a
real mosque box, notes are most of the value. Be honest about this in your FYP report
and in sales. The strong claim is not "the box counts money". It is "the box creates
an independent timeline that the witnessed count is checked against, and every gap is
logged". Banknote detection (camera in the chute, or a note validator) is a later
phase and out of scope here.

## 2. Shopping list

Prices are rough Malaysian ringgit, check Shopee or Lazada.

| Part | Why | Notes |
|---|---|---|
| Raspberry Pi 5 (you have it) | Runs the script | Needs official 5V 5A supply and microSD with Raspberry Pi OS 64-bit |
| HX711 module | 24-bit amplifier for the load cell | Pick one with a 10 SPS / 80 SPS jumper if available. Cheap ones are fine |
| **1 kg** bar load cell (half-bridge pair is not needed, use the 4-wire single bar) | Weighs the tray | 1 kg, not 5 kg or 50 kg. Bigger cells lose resolution and you are measuring 1 g coins |
| Small rigid tray | Coins land here | Plastic or aluminium, light. Mass of tray eats into range, keep it under 100 g |
| 2 x M5 or M4 bolts, nuts, 2 spacers | Mount the cell | See section 4 |
| Jumper wires (female-female), 4 pieces | HX711 to Pi | |
| A 0.01 g kitchen scale or jewellery scale | Weigh your actual coins | Important, see section 6. About RM15 to 30 |
| A known reference weight | Calibration | A new 50 sen is 5.66 g, but a calibration weight (20 g or 50 g) is better |

Optional: a short HDMI cable and keyboard for first setup, or just SSH.

## 3. Wiring

HX711 to load cell (colours vary, check the sheet that came with your cell):

| Load cell wire | HX711 pin |
|---|---|
| Red | E+ |
| Black | E- |
| White | A- |
| Green | A+ |

If the reading goes **down** when you add weight, swap A+ and A-.

HX711 to Raspberry Pi 5:

| HX711 | Pi pin | Pi GPIO |
|---|---|---|
| VCC | Pin 1 (3.3V) | |
| GND | Pin 6 (GND) | |
| DT (DOUT) | Pin 29 | GPIO 5 |
| SCK | Pin 31 | GPIO 6 |

Power the HX711 from **3.3V**, not 5V. At 5V its data line can output 5V into a pin
that is only rated for 3.3V.

If you wire to other GPIOs, pass `--dout` and `--sck`, or set `AMANAH_HX711_DOUT`
and `AMANAH_HX711_SCK`.

## 4. Mounting the load cell (this is where most projects fail)

A bar load cell has one end fixed and one end free. The free end must be the only
thing touching the tray.

1. Bolt the **fixed end** (the end with the arrow pointing away from it, check the
   arrow on the cell) to the box floor or a rigid block. Use spacers so the free end
   can move down by about 1 mm without touching the floor.
2. Bolt the tray to the **free end** with spacers so the tray sits above the cell.
3. The tray must touch nothing else. Not the walls, not the coin chute, not wires.
   Leave 3 to 5 mm of clearance all round.
4. Route the coin slot so coins drop **onto the tray** and nothing gets between the
   tray and the walls. A short vertical chute with a funnel works.
5. Keep the wires loose. Tight wires pull on the cell and cause drift.

Test: press the tray gently. It should spring back. Tap the box: reading should
settle within a second.

## 5. Pi setup

On the Pi (SSH or terminal):

```bash
sudo apt update
sudo apt install -y python3-venv python3-lgpio git
mkdir -p ~/amanahtrack && cd ~/amanahtrack
```

Copy the `device/` folder from your project onto the Pi (USB stick, or `scp` from your PC):

```bash
scp -r device pi@raspberrypi.local:~/amanahtrack/
```

Then:

```bash
cd ~/amanahtrack/device
python3 -m venv --system-site-packages venv
source venv/bin/activate
# no extra packages needed, the script only uses the Python standard library
```

`--system-site-packages` is there so the venv can see the `lgpio` library installed by apt.

Test the whole path without any hardware first:

```bash
python box_client.py --simulate --once
```

You should see four fake coins and `+2.97 g -> RM 0.10` style lines. If the backend is not
reachable the events are saved to a queue file and sent later.

## 6. Weigh your own coins

`coins.json` has published catalogue weights. Real coins in a donation box are worn,
dirty and sometimes foreign. Weigh 20 of each type on the 0.01 g scale, divide by 20,
and overwrite the `grams` values in `coins.json`.

Add the 5 sen (new) and 20 sen (new) entries when you have them. I left them out on
purpose because I could not confirm their published weights.

If you handle a coin type that is not in the table, the script cannot explain it and
logs `unexplained_weight`. That is correct behaviour, not a bug.

## 7. Calibrate

Do this with the tray mounted, box closed, nothing on it.

```bash
python box_client.py --calibrate --dout 5 --sck 6
```

1. Press Enter with the tray empty. It prints `offset = ...`.
2. Put the known weight on the tray, type its grams (for example `50`).
3. It prints `scale = ...`.

Put both values into the environment (section 8). Then check with a **different**
weight, for example a single coin. If it is off by more than 0.1 g, go back to section 4,
the mount is not rigid or something touches the tray.

Do the calibration again if you move the box or change the tray.

## 8. Register the box and configure the Pi

On your PC, in the backend folder with the venv active, give the device a real secret
instead of the demo one:

```powershell
python set_device_secret.py BOX-002
```

It prints `AMANAH_DEVICE_SECRET=...`. Copy it.

Make the backend reachable from the Pi. Start it on all interfaces:

```powershell
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Find your PC's IP with `ipconfig` (IPv4 address, for example `192.168.1.20`). The Pi and
PC must be on the same Wi-Fi. Windows may ask to allow Python through the firewall, allow
it on private networks.

On the Pi create `~/amanahtrack/device/box.env`:

```
AMANAH_API_URL=http://192.168.1.20:8000
AMANAH_DEVICE_SERIAL=BOX-002
AMANAH_DEVICE_SECRET=paste-the-secret-here
AMANAH_HX711_DOUT=5
AMANAH_HX711_SCK=6
AMANAH_HX711_OFFSET=paste-from-calibration
AMANAH_HX711_SCALE=paste-from-calibration
AMANAH_QUEUE_FILE=/home/pi/amanahtrack/device/queue.jsonl
```

Run it:

```bash
set -a; source box.env; set +a
python box_client.py
```

Drop a coin. You should see `+2.97 g -> RM 0.10 ...`. Open the app ledger: a
provisional entry appears. The status turns confirmed only after a count session.

## 9. Run on boot (systemd)

Create `/etc/systemd/system/amanah-box.service`:

```ini
[Unit]
Description=AmanahTrack box client
After=network-online.target
Wants=network-online.target

[Service]
User=pi
WorkingDirectory=/home/pi/amanahtrack/device
EnvironmentFile=/home/pi/amanahtrack/device/box.env
ExecStart=/home/pi/amanahtrack/device/venv/bin/python box_client.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now amanah-box
journalctl -u amanah-box -f
```

Change `pi` to your Linux username if it is different.

If Wi-Fi drops, events are appended to the queue file and delivered when the network returns.

## 10. How it fits the count flow

1. Coins drop in. Provisional entries appear with a confidence value.
2. Box is opened. Weight drops a lot. Event `tray_emptied` is sent.
3. Treasurer and witness count. In the app, **Count** screen, enter the real total.
4. Server marks that box's provisional entries confirmed and posts a count adjustment
   for the difference between your counted total and the sensor estimates (positive if
   you counted more, for example because of notes).
5. The hash chain seals everything. Variance is permanent and auditable.

## 11. Known limits and honest warnings

- **Not tested on hardware.** The script was run against a simulated scale and a real
  backend. The HX711 code path (bit-banged with `lgpio`) has not touched a real HX711.
  The Pi 5 has no kernel-timed GPIO for this, and the HX711 can glitch if the bit-bang
  is interrupted. If readings are noisy or random, the fallback is an ESP32 or Pi Pico
  running a known HX711 library and sending weight over USB serial, with this script
  reading the serial port instead. Ask me and I will write that variant.
- **No idempotency key yet.** If a POST succeeds but the reply is lost, the queued retry
  can record the same insertion twice. The witnessed count corrects it, but it is a
  known gap. I will add an event ID next.
- **The count screen is hardcoded to `BOX-002`** in `mobile/app/count.tsx`.
- **Change every default secret** (`AMANAH_SECRET_KEY`, device secrets, demo passwords)
  before a real mosque uses this.
- Temperature and a box sitting on an uneven floor both shift the baseline. The script
  re-baselines between events, but do not expect 0.01 g accuracy.
- Do not put the Pi or HX711 inside a metal box that touches the load cell wiring.

## 12. What to say in your FYP

"The box produces a provisional, independently measured estimate of coin receipts. It
cannot value banknotes. The ledger treats the estimate as unconfirmed until a witnessed
count, and records the variance permanently." That claim is true and defensible.
