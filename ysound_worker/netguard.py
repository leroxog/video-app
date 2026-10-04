"""Keep a Python process off the internet, without needing administrator rights.

serve_model.py calls install() before the AI code is imported. From then on every attempt of this process
to reach anything but this computer itself (127.0.0.1 / ::1 / localhost) raises an error -- looking up a
name, connecting a socket, create_connection.

Honest limits: this is a safety net against ordinary code and libraries phoning home (requests, urllib,
httpx, huggingface_hub all go through the functions patched here). It is NOT a wall against deliberately
malicious code, which could use low-level tricks. The wall is the Windows Firewall rule from harden.ps1
(blocks the model's python.exe from the network at the operating-system level) -- use both.
"""
import ipaddress
import socket

_installed = False


class BlockedNetworkError(OSError):
    pass


def is_local(host):
    if isinstance(host, bytes):
        host = host.decode("ascii", "ignore")
    if host in ("localhost", "localhost.localdomain"):
        return True
    try:
        return ipaddress.ip_address(str(host).split("%")[0]).is_loopback
    except ValueError:
        return False                          # any other name would need a DNS lookup: not allowed


def _address_host(address):
    return address[0] if isinstance(address, (tuple, list)) else address


def install():
    """Patch the socket module (once). Returns True if it patched, False if it already had."""
    global _installed
    if _installed:
        return False
    _installed = True
    real_getaddrinfo, real_connect, real_connect_ex, real_create = (
        socket.getaddrinfo, socket.socket.connect, socket.socket.connect_ex, socket.create_connection)

    def guarded_getaddrinfo(host, *args, **kwargs):
        if host is not None and host != "" and not is_local(host):
            raise BlockedNetworkError(f"network blocked by ysound netguard: lookup of {host!r}")
        return real_getaddrinfo(host, *args, **kwargs)

    def guarded_connect(self, address):
        if self.family in (socket.AF_INET, socket.AF_INET6) and not is_local(_address_host(address)):
            raise BlockedNetworkError(f"network blocked by ysound netguard: connect to {address!r}")
        return real_connect(self, address)

    def guarded_connect_ex(self, address):
        if self.family in (socket.AF_INET, socket.AF_INET6) and not is_local(_address_host(address)):
            raise BlockedNetworkError(f"network blocked by ysound netguard: connect to {address!r}")
        return real_connect_ex(self, address)

    def guarded_create_connection(address, *args, **kwargs):
        if not is_local(_address_host(address)):
            raise BlockedNetworkError(f"network blocked by ysound netguard: connect to {address!r}")
        return real_create(address, *args, **kwargs)

    socket.getaddrinfo = guarded_getaddrinfo
    socket.socket.connect = guarded_connect
    socket.socket.connect_ex = guarded_connect_ex
    socket.create_connection = guarded_create_connection
    return True
