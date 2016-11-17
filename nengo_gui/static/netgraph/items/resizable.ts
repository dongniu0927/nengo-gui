import * as interact from "interact.js";
import { VNode, dom, h  } from "maquette";

// import * as menu from "../../menu";
import { config } from "../../config";
import { MenuItem } from "../../menu";
import { Shape } from "../../utils";
import { InteractableItem, InteractableItemArg } from "./interactable";
import { NetGraphItemArg } from "./item";

abstract class ResizableItem extends InteractableItem {
    constructor(ngiArg: NetGraphItemArg, interArg: InteractableItemArg) {
        super(ngiArg, interArg);

        interact(this.area).resizable({
                edges: {bottom: true, left: true, right: true, top: true},
                invert: "none",
                margin: 10,
            }).on("resizestart", event => {
                this.menu.hideAny();
            }).on("resizemove", event => {
                const item = this.ng.svgObjects[this.uid];
                const pos = item.getScreenLocation();
                let hScale = this.ng.getScaledWidth();
                let vScale = this.ng.getScaledHeight();
                let parent = item.parent;
                while (parent !== null) {
                    hScale = hScale * parent.width * 2;
                    vScale = vScale * parent.height * 2;
                    parent = parent.parent;
                }

                if (this.aspect !== null) {
                    this.constrainAspect();

                    const verticalResize =
                        event.edges.bottom || event.edges.top;
                    const horizontalResize =
                        event.edges.left || event.edges.right;

                    let w = pos[0] - event.clientX + this.ng.offsetX;
                    let h = pos[1] - event.clientY + this.ng.offsetY;

                    if (event.edges.right) {
                        w *= -1;
                    }
                    if (event.edges.bottom) {
                        h *= -1;
                    }
                    if (w < 0) {
                        w = 1;
                    }
                    if (h < 0) {
                        h = 1;
                    }

                    const screenW = item.width * hScale;
                    const screenH = item.height * vScale;

                    if (horizontalResize && verticalResize) {
                        const p = (screenW * w + screenH * h) / Math.sqrt(
                            screenW * screenW + screenH * screenH);
                        const norm = Math.sqrt(
                            this.aspect * this.aspect + 1);
                        h = p / (this.aspect / norm);
                        w = p * (this.aspect / norm);
                    } else if (horizontalResize) {
                        h = w / this.aspect;
                    } else {
                        w = h * this.aspect;
                    }

                    item.width = w / hScale;
                    item.height = h / vScale;
                } else {
                    const dw = event.deltaRect.width / hScale / 2;
                    const dh = event.deltaRect.height / vScale / 2;
                    const offsetX = dw + event.deltaRect.left / hScale;
                    const offsetY = dh + event.deltaRect.top / vScale;

                    item.width += dw;
                    item.height += dh;
                    item.x += offsetX;
                    item.y += offsetY;
                }

                item.redraw();

                if (this.depth === 1) {
                    this.ng.scaleMiniMap();
                }
            }).on("resizeend", event => {
                const item = this.ng.svgObjects[this.uid];
                item.constrainPosition();
                item.redraw();
                this.ng.notify({
                    act: "posSize",
                    height: item.height,
                    uid: this.uid,
                    width: item.width,
                    x: item.x,
                    y: item.y,
                });
            });
    }

    redrawSize() {
        const screenD = super.redrawSize();

        const halfW = screenD.width / 2;
        const halfH = screenD.height / 2;
        this.shape = h("g", {
            transform: "",
            translate: "(-" + halfW + ", -" + halfH + ")",
            width: screenD.width,
            height: screenD.height,
        });

        return screenD;
    }

    /**
     * Determine the fill color based on the depth.
     */
    computeFill() {
        const depth = this.ng.transparentNets ? 1 : this.depth;

        let rgb = Math.round(255 * Math.pow(0.8, depth));
        const fill = "rgb(" + rgb + "," + rgb + "," + rgb + ")";

        rgb = Math.round(255 * Math.pow(0.8, depth + 2));
        const stroke = "rgb(" + rgb + "," + rgb + "," + rgb + ")";

        this.shape = h("g", {
            style: "fill=" + fill + ", stroke=" + stroke,
        });
    }
}

export class NodeItem extends ResizableItem {
    htmlNode;

    constructor(ngiArg: NetGraphItemArg, interArg: InteractableItemArg, html) {
        super(ngiArg, interArg);
        this.shape = h("rect");
        this.htmlNode = html;
        this.g.classlist.add("node");
    }

    generateMenu() {
        const items = [];
        // TODO: Holy fuck, how do you even use interfaces
        // TODO: And why are none of these properties being found
        items.push(MenuItem = {
            html: "Slider",
            callback: () => {
                this.createGraph("Slider");
            }
        });
        if (this.dimensions > 0) {
            items.push(["Value", () => {
                this.createGraph("Value");
            }]);
        }
        if (this.dimensions > 1) {
            items.push(["XY-value", () => {
                this.createGraph("XYValue");
            }]);
        }
        if (this.htmlNode) {
            items.push(["HTML", () => {
                this.createGraph("HTMLView");
            }]);
        }

        items.push(["Details ...", () => {
            this.createModal();
        }]);
        return items;
    }

    redrawSize() {
        const screenD = super.redrawSize();

        const radius = Math.min(screenD.width, screenD.height);
        // TODO: Don't hardcode .1 as the corner radius scale
        this.shape = h("g", {rx: radius * .1, ry: radius * .1});
    }
}

export class NetItem extends ResizableItem {
    expanded: boolean;
    spTargets;
    defaultOutput;

    constructor(ngiArg: NetGraphItemArg, interArg: InteractableItemArg,
                expanded, spTargets, defaultOutput) {
        super(ngiArg, interArg);
        this.shape = h("rect");
        this.expanded = expanded;
        this.spTargets = spTargets;
        this.defaultOutput = defaultOutput;

        // If a network is flagged to expand on creation, then expand it
        if (expanded) {
            // Report to server but do not add to the undo stack
            this.expand(true, true);
        }

        // TODO: Is this the right way to override an interact method?
        interact(this.g)
            .on("doubletap", event => {
                // Get rid of menus when clicking off
                if (event.button === 0) {
                    if (this.menu.visibleAny()) {
                        this.menu.hideAny();
                    } else {
                        if (this.expanded) {
                            this.collapse(true);
                        } else {
                            this.expand();
                        }
                    }
                }
            });
        this.g.classlist.add("network")
    }

    remove() {
        super.remove();
        if (this.expanded) {
            // Collapse the item, but don't tell the server since that would
            // update the server's config
            this.collapse(false);
        }
    }

    generateMenu() {
        const items = [];
        if (this.expanded) {
            items.push(["Collapse network", () => {
                this.collapse(true);
            }]);
            items.push(["Auto-layout", () => {
                this.requestFeedforwardLayout();
            }]);
        } else {
            items.push(["Expand network", () => {
                this.expand();
            }]);
        }
        if (this.defaultOutput && this.spTargets.length === 0) {
            items.push(["Output Value", () => {
                this.createGraph("Value");
            }]);
        }

        if (this.spTargets.length > 0) {
            items.push(["Semantic pointer cloud", () => {
                this.createGraph("Pointer", this.spTargets[0]);
            }]);
            items.push(["Semantic pointer plot", () => {
                this.createGraph("SpaSimilarity", this.spTargets[0]);
            }]);
        }

        items.push(["Details ...", () => {
            this.createModal();
        }]);
        return items;
    }

    /**
     * Expand a collapsed network.
     */
    expand(returnToServer=true, auto=false) { // tslint:disable-line
        // Default to true if no parameter is specified
        if (typeof returnToServer !== "undefined") {
            returnToServer = true;
        }
        auto = typeof auto !== "undefined" ? auto : false;

        this.g.classList.add("expanded");

        if (!this.expanded) {
            this.expanded = true;
            if (this.ng.transparentNets) {
                this.shape = h("g", {style: "fill-opacity=0.0"});
            }
            this.gItems.removeChild(this.g);
            this.gNetworks.appendChild(this.g);
            if (!this.minimap) {
                this.miniItem.expand(returnToServer, auto);
            }
        } else {
            console.warn(
                "expanded a network that was already expanded: " + this);
        }

        if (returnToServer) {
            if (auto) {
                // Update the server, but do not place on the undo stack
                // TODO: Does this need a uid?
                // probably?
                this.attached.forEach(conn => {
                    conn.send("netgraph.autoExpand");
                });
            } else {
                this.attached.forEach(conn => {
                    conn.send("netgraph.expand");
                });
            }
        }
    }

    /**
     * Collapse an expanded network.
     */
    collapse(reportToServer, auto=false) { // tslint:disable-line
        this.g.classList.remove("expanded");

        // Remove child NetGraphItems and NetGraphConnections
        while (this.childConnections.length > 0) {
            this.childConnections[0].remove();
        }
        while (this.children.length > 0) {
            this.children[0].remove();
        }

        if (this.expanded) {
            this.expanded = false;
            if (this.ng.transparentNets) {
                this.shape = h("g", {style: "fill-opacity=1.0"});
            }
            this.gNetworks.removeChild(this.g);
            this.gItems.appendChild(this.g);
            if (!this.minimap) {
                this.miniItem.collapse(reportToServer, auto);
            }
        } else {
            console.warn(
                "collapsed a network that was already collapsed: " + this);
        }

        if (reportToServer) {
            if (auto) {
                // Update the server, but do not place on the undo stack
                this.ng.notify({act: "autoCollapse", uid: this.uid});
            } else {
                this.ng.notify({act: "collapse", uid: this.uid});
            }
        }
    }

    get transparentNets(): boolean {
        return config.transparentNets;
    }

    set transparentNets(val: boolean) {
        if (val === config.transparentNets) {
            return;
        }
        config.transparentNets = val;
        Object.keys(this.svgObjects).forEach(key => {
            const ngi = this.svgObjects[key];
            ngi.computeFill();
            if (ngi.type === "net" && ngi.expanded) {
                ngi.shape.style["fill-opacity"] = val ? 0.0 : 1.0;
            }
        });
    }
}

export class EnsembleItem extends ResizableItem {
    shape: VNode;

    constructor(ngiArg: NetGraphItemArg, interArg: InteractableItemArg) {
        super(ngiArg, interArg);

        // TODO: This means it resizes differently and other stuff!
        this.aspect = 1.;
        this.shape = this.ensembleSvg();
        interact(this.area).resizable({
            invert: "reposition",
        });
        this.g.classlist("ensemble")
    }

    /**
     * Function for drawing ensemble svg.
     */
    ensembleSvg() {
        const shape = h("g", {class: "ensemble"});

        const dx = -1.25;
        const dy = 0.25;

        let circle: VNode;

        circle = h("circle", {cx: -11.157 + dx, cy: -7.481 + dy, r: "4.843"});
        shape.children.push(circle);
        circle = h("circle", {cx: 0.186 + dx, cy: -0.127 + dy, r: "4.843"});
        shape.children.push(circle);
        circle = h("circle", {cx: 5.012 + dx, cy: 12.56 + dy, r: "4.843"});
        shape.children.push(circle);
        circle = h("circle", {cx: 13.704 + dx, cy: -0.771 + dy, r: "4.843"});
        shape.children.push(circle);
        circle = h("circle", {cx: -10.353 + dx, cy: 8.413 + dy, r: "4.843"});
        shape.children.push(circle);
        circle = h("circle", {cx: 3.894 + dx, cy: -13.158 + dy, r: "4.843"});
        shape.children.push(circle);

        return shape;
    }

    generateMenu() {
        const items = [];
        items.push(["Value", () => {
            this.createGraph("Value");
        }]);
        if (this.dimensions > 1) {
            items.push(["XY-value", () => {
                this.createGraph("XYValue");
            }]);
        }
        items.push(["Spikes", () => {
            this.createGraph("Raster");
        }]);
        items.push(["Voltages", () => {
            this.createGraph("Voltage");
        }]);
        items.push(["Firing pattern", () => {
            this.createGraph("SpikeGrid");
        }]);

        items.push(["Details ...", () => {
            this.createModal();
        }]);
        return items;
    }

    redrawSize() {
        const screenD = super.redrawSize();

        const width = screenD.width;
        const height = screenD.height;
        const scale = Math.sqrt(height * height + width * width) / Math.sqrt(2);

        const r = 17.8; // TODO: Don't hardcode the size of the ensemble
        this.shape = h("g", {
            class: "ensemble",
            transform: "scale(" + scale / 2 / r + ")",
            style: "stroke-width" + 20 / scale,
        });

        this.area = h("rect", {
            style: "fill:transparent",
            width: width * 0.97,
        });
    }
}