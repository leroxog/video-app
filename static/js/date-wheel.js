// TikTok-style scrollable Tag/Monat/Jahr picker for birthdate fields
// (2026-09-09, "so scrollen wie bei tiktok"). Three independently
// scrollable, snapping columns feed a plain hidden <input> that already
// holds the real "YYYY-MM-DD" value and fires a real "change" event --
// register.html/complete_profile.html's existing age-gate/kids-account
// script reads that same input exactly as it did when it was a native
// <input type="date">, completely unchanged. This file only replaces how
// the date gets entered, never how it's read afterwards.
(function () {
    const MONTH_NAMES = [
        "Januar", "Februar", "März", "April", "Mai", "Juni",
        "Juli", "August", "September", "Oktober", "November", "Dezember",
    ];
    const ITEM_HEIGHT = 40;
    // How many years back the picker reaches -- generous on purpose (this
    // gates a real minimum-age/guardian-email flow, not a cosmetic field).
    const YEAR_SPAN = 100;
    // Deliberately NOT "today" or "day 1" -- defaults to a plausible young-
    // adult age so the kids-account bubble doesn't pop up unprompted the
    // moment the page loads, before anyone has touched anything.
    const DEFAULT_AGE = 20;

    function daysInMonth(year, month) {
        // month is 1-12 here; day 0 of the next JS (0-based) month is the
        // last real day of `month`.
        return new Date(year, month, 0).getDate();
    }

    function buildColumn(col, values, formatFn) {
        const list = col.querySelector(".date-wheel-list");
        const focused = document.activeElement === list;
        list.innerHTML = "";
        list.appendChild(Object.assign(document.createElement("div"), { className: "date-wheel-pad" }));
        values.forEach((v) => {
            const item = document.createElement("div");
            item.className = "date-wheel-item";
            item.dataset.value = String(v);
            item.setAttribute("role", "option");
            item.textContent = formatFn ? formatFn(v) : String(v);
            list.appendChild(item);
        });
        list.appendChild(Object.assign(document.createElement("div"), { className: "date-wheel-pad" }));
        col._values = values;
        if (focused) list.focus();
    }

    function scrollToValue(col, value, smooth) {
        const list = col.querySelector(".date-wheel-list");
        const idx = col._values.indexOf(value);
        if (idx === -1) return;
        list.scrollTo({ top: idx * ITEM_HEIGHT, behavior: smooth ? "smooth" : "auto" });
    }

    function nearestIndex(list) {
        const idx = Math.round(list.scrollTop / ITEM_HEIGHT);
        return Math.max(0, Math.min(list.querySelectorAll(".date-wheel-item").length - 1, idx));
    }

    function currentValue(col) {
        const list = col.querySelector(".date-wheel-list");
        return col._values[nearestIndex(list)];
    }

    function highlightCenter(col) {
        const list = col.querySelector(".date-wheel-list");
        const items = list.querySelectorAll(".date-wheel-item");
        const idx = nearestIndex(list);
        items.forEach((item, i) => {
            const isCenter = i === idx;
            item.classList.toggle("is-center", isCenter);
            item.setAttribute("aria-selected", isCenter ? "true" : "false");
        });
    }

    // Turns wrapEl (containing three [data-unit="day"|"month"|"year"]
    // columns, each with a .date-wheel-list) into a working picker that
    // keeps hiddenInput's value in sync. Safe to call once per element.
    window.initDateWheel = function (wrapEl, hiddenInput) {
        const dayCol = wrapEl.querySelector('[data-unit="day"]');
        const monthCol = wrapEl.querySelector('[data-unit="month"]');
        const yearCol = wrapEl.querySelector('[data-unit="year"]');

        const now = new Date();
        const maxYear = now.getFullYear();
        const minYear = maxYear - YEAR_SPAN;
        const years = [];
        for (let y = maxYear; y >= minYear; y--) years.push(y);
        buildColumn(yearCol, years);
        buildColumn(monthCol, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], (m) => MONTH_NAMES[m - 1]);

        let day = 1, month = 1, year = maxYear - DEFAULT_AGE;
        const initial = /^(\d{4})-(\d{2})-(\d{2})$/.exec(hiddenInput.value || "");
        if (initial) {
            year = Math.min(maxYear, Math.max(minYear, parseInt(initial[1], 10)));
            month = parseInt(initial[2], 10);
            day = parseInt(initial[3], 10);
        }

        function rebuildDays(preserveDay) {
            const dim = daysInMonth(year, month);
            const days = [];
            for (let d = 1; d <= dim; d++) days.push(d);
            buildColumn(dayCol, days);
            const clamped = Math.min(preserveDay, dim);
            scrollToValue(dayCol, clamped, false);
            highlightCenter(dayCol);
            return clamped;
        }

        day = rebuildDays(day);
        scrollToValue(monthCol, month, false);
        scrollToValue(yearCol, year, false);
        highlightCenter(monthCol);
        highlightCenter(yearCol);

        function commit() {
            day = currentValue(dayCol);
            month = currentValue(monthCol);
            year = currentValue(yearCol);
            const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
            if (hiddenInput.value !== iso) {
                hiddenInput.value = iso;
                hiddenInput.dispatchEvent(new Event("change", { bubbles: true }));
            }
        }

        function wireColumn(col, isMonthOrYear) {
            const list = col.querySelector(".date-wheel-list");
            let settleTimer = null;

            function settle() {
                const idx = nearestIndex(list);
                list.scrollTo({ top: idx * ITEM_HEIGHT, behavior: "smooth" });
                if (isMonthOrYear) {
                    month = currentValue(monthCol);
                    year = currentValue(yearCol);
                    day = rebuildDays(day);
                }
                highlightCenter(col);
                commit();
            }

            list.addEventListener("scroll", () => {
                highlightCenter(col);
                clearTimeout(settleTimer);
                settleTimer = setTimeout(settle, 120);
            }, { passive: true });

            list.addEventListener("click", (event) => {
                const item = event.target.closest(".date-wheel-item");
                if (!item) return;
                const items = Array.from(list.querySelectorAll(".date-wheel-item"));
                list.scrollTo({ top: items.indexOf(item) * ITEM_HEIGHT, behavior: "smooth" });
            });

            // Basic keyboard support (Up/Down/Home/End) -- the wheel isn't
            // a native <input>, so this is the minimum to keep it usable
            // without a mouse/touch.
            list.addEventListener("keydown", (event) => {
                const items = list.querySelectorAll(".date-wheel-item");
                let idx = nearestIndex(list);
                if (event.key === "ArrowDown") idx = Math.min(items.length - 1, idx + 1);
                else if (event.key === "ArrowUp") idx = Math.max(0, idx - 1);
                else if (event.key === "Home") idx = 0;
                else if (event.key === "End") idx = items.length - 1;
                else return;
                event.preventDefault();
                list.scrollTo({ top: idx * ITEM_HEIGHT, behavior: "smooth" });
            });
        }

        wireColumn(dayCol, false);
        wireColumn(monthCol, true);
        wireColumn(yearCol, true);

        commit();
    };
})();
