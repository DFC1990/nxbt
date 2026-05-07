from setuptools import setup

setup(
    name="nxbt",
    include_package_data=True,
    long_description_content_type="text/markdown",
    python_requires=">=3.9",
    install_requires=[
        # dbus-python 1.3.2+ supports Python 3.13; wheels available for ARM
        "dbus-python>=1.3.2,<2",
        # Flask 3.1+ has Python 3.13 support; Werkzeug 3.x required by Flask 3.x
        "Flask>=3.1.0,<4",
        "Werkzeug>=3.1.0,<4",
        "Flask-SocketIO>=5.4.1,<6",
        "Flask-Limiter>=3.5.0",
        # eventlet 0.37+ improved Python 3.12/3.13 greenlet compatibility
        "eventlet>=0.37.0,<0.39",
        "blessed>=1.20.0",
        "pynput>=1.7.6",
        # psutil 6.x cleans up deprecated APIs; pure-Python fallback on ARM
        "psutil>=6.0.0,<7",
        # cryptography 3.3.2 has known CVEs — upgrade to 41+ for security patches
        "cryptography>=41.0.7",
        "jinja2>=3.1.4,<4",
        "itsdangerous>=2.2.0,<3",
    ],
    extras_require={
        "dev": [
            "pytest>=8.0",
        ]
    }
)
