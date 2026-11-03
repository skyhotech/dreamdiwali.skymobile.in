"""Selenium smoke tests against a deployed site, in a real Chrome window.

Run: SITE=https://… E2E_USER=… E2E_PASS=… E2E_TOKEN=… pytest tests/selenium
Admin and customer checks need a temporary staff login and a test customer's
link token; without them those tests are skipped.
"""

import os

import pytest
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait

SITE = os.environ.get("SITE", "https://dreamdiwali-skymobile-in.vercel.app").rstrip("/")
USER, PASSWORD = os.environ.get("E2E_USER"), os.environ.get("E2E_PASS")
TOKEN = os.environ.get("E2E_TOKEN")
PHONE_WIDTH = 420


@pytest.fixture(scope="module")
def browser():
    options = webdriver.ChromeOptions()
    if os.environ.get("HEADLESS"):
        options.add_argument("--headless=new")
    options.add_argument(f"--window-size={PHONE_WIDTH},900")
    driver = webdriver.Chrome(options=options)
    yield driver
    driver.quit()


def wait_for(browser, selector, timeout=45):
    return WebDriverWait(browser, timeout).until(
        EC.visibility_of_element_located((By.CSS_SELECTOR, selector))
    )


def wait_text(browser, text, timeout=45):
    WebDriverWait(browser, timeout).until(lambda d: text in d.find_element(By.TAG_NAME, "body").text)


def test_manager_form_loads_with_seeded_branches(browser):
    browser.get(SITE + "/")
    wait_for(browser, "#m-name")
    field = browser.find_element(By.ID, "m-branch")
    browser.execute_script("arguments[0].scrollIntoView({block: 'center'})", field)
    field.click()
    options = WebDriverWait(browser, 30).until(
        lambda d: d.find_elements(By.CSS_SELECTOR, "#m-branch-list [role=option]")
    )
    assert len(options) >= 31


def test_manager_form_fits_a_phone(browser):
    browser.get(SITE + "/")
    wait_for(browser, "#m-name")
    width = browser.execute_script("return document.documentElement.scrollWidth")
    viewport = browser.execute_script("return window.innerWidth")
    assert width <= viewport


def test_unknown_link_explains_itself(browser):
    browser.get(SITE + "/?spin=selenium-unknown-link")
    wait_text(browser, "isn't valid")


@pytest.mark.skipif(not TOKEN, reason="needs E2E_TOKEN of a finished test customer")
def test_finished_link_returns_to_the_poster(browser):
    browser.get(f"{SITE}/?spin={TOKEN}")
    wait_text(browser, "Your Diwali poster")
    # Share buttons appear once the poster image has downloaded.
    for name in ("Instagram", "Facebook", "WhatsApp", "More"):
        WebDriverWait(browser, 45).until(
            EC.presence_of_element_located((By.XPATH, f"//button[normalize-space()='{name}']"))
        )
    assert "Tap to spin" not in browser.find_element(By.TAG_NAME, "body").text


@pytest.mark.skipif(not (USER and PASSWORD), reason="needs a temporary staff login")
def test_admin_sign_in_and_every_page(browser):
    browser.get(SITE + "/sky/mirror/admin/login/")
    wait_for(browser, "#id_username").send_keys(USER)
    browser.find_element(By.ID, "id_password").send_keys(PASSWORD)
    browser.find_element(By.CSS_SELECTOR, "button[type=submit]").click()
    WebDriverWait(browser, 45).until(lambda d: "/login" not in d.current_url)
    for view in ("dashboard", "mirrors", "branches", "spin-items", "customers"):
        browser.get(f"{SITE}/sky/mirror/admin/#{view}")
        browser.refresh()
        wait_for(browser, f"#view-{view}")
        width = browser.execute_script("return document.documentElement.scrollWidth")
        assert width <= browser.execute_script("return window.innerWidth"), view


@pytest.mark.skipif(not (USER and PASSWORD), reason="needs a temporary staff login")
def test_admin_lists_the_test_customer_with_details(browser):
    browser.get(SITE + "/sky/mirror/admin/#customers")
    browser.refresh()
    card = wait_for(browser, ".cust.pro")
    WebDriverWait(browser, 30).until(lambda d: "E2E TEST CUSTOMER" in d.find_element(By.ID, "c-grid").text)
    card = next(c for c in browser.find_elements(By.CSS_SELECTOR, ".cust.pro") if "E2E TEST CUSTOMER" in c.text)
    assert "₹15,000" in card.text
    card.find_element(By.CSS_SELECTOR, "button.details").click()
    wait_for(browser, "dialog .track li")
