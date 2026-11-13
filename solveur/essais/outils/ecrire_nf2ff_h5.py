#!/usr/bin/python3
"""Ecrit un fichier « nf2ff.h5 » comme le fait nf2ff d'openEMS 0.0.36, par la VRAIE
bibliotheque HDF5 (libhdf5 du systeme, appelee par ctypes) et dans le meme ordre d'appels que
tools/hdf5_file_writer.cpp : fichier rouvert a chaque ecriture, groupes crees au besoin,
reglages d'usine partout. Sert de reference au lecteur en Rust pur (src/hdf5.rs).

    python3 ecrire_nf2ff_h5.py sortie.h5 [graine]

Les valeurs sont celles de `champs(graine)` ci-dessous, que le banc numpy reprend.
"""
import ctypes
import ctypes.util
import sys

import numpy as np


def champs(graine=1, n_theta=181, n_phi=2):
    """Un champ lointain de synthese : (theta, phi) en radians, E_theta, E_phi [theta][phi],
    P_rad, Dmax, Prad."""
    g = np.random.default_rng(graine)
    theta = np.deg2rad(np.linspace(-180.0, 180.0, n_theta)).astype(np.float32)
    phi = np.deg2rad(np.linspace(0.0, 90.0, n_phi)).astype(np.float32)
    T, P = np.meshgrid(theta.astype(float), phi.astype(float), indexing="ij")
    e_t = (np.cos(T) * np.cos(P) + 0.05 * g.standard_normal(T.shape)) * np.exp(1j * 0.7 * T)
    e_p = (0.3 * np.sin(T) * np.sin(P) + 0.05 * g.standard_normal(T.shape)) * np.exp(-1j * 0.2)
    p_rad = np.abs(e_t) ** 2 + np.abs(e_p) ** 2
    return theta, phi, e_t, e_p, p_rad, 4.6183 + graine, 3.2e-23 * graine


def ecrire(chemin, graine=1, freq=2.45e9):
    lib = ctypes.CDLL(ctypes.util.find_library("hdf5_serial") or ctypes.util.find_library("hdf5")
                      or "libhdf5_serial.so.103")
    hid = ctypes.c_int64
    for nom in ("H5Fcreate", "H5Fopen", "H5Gcreate2", "H5Gopen2", "H5Screate_simple", "H5Dcreate2",
                "H5Acreate2", "H5Oopen"):
        getattr(lib, nom).restype = hid
    lib.H5open()
    FLOAT = hid.in_dll(lib, "H5T_NATIVE_FLOAT_g").value
    DOUBLE = hid.in_dll(lib, "H5T_NATIVE_DOUBLE_g").value
    b = chemin.encode()
    h = lib.H5Fcreate(b, 2, hid(0), hid(0))                 # H5F_ACC_TRUNC
    assert h >= 0
    lib.H5Fclose(hid(h))

    def groupe(f, nom):
        g = lib.H5Gopen2(hid(f), b"/", hid(0))
        for morceau in [m for m in nom.split("/") if m]:
            if lib.H5Lexists(hid(g), morceau.encode(), hid(0)) > 0:
                n = lib.H5Gopen2(hid(g), morceau.encode(), hid(0))
            else:
                n = lib.H5Gcreate2(hid(g), morceau.encode(), hid(0), hid(0), hid(0))
            lib.H5Gclose(hid(g))
            g = n
        return g

    def donnees(grp, nom, tableau, genre):
        f = lib.H5Fopen(b, 1, hid(0))                       # H5F_ACC_RDWR
        g = groupe(f, grp)
        t = np.ascontiguousarray(tableau)
        dims = (ctypes.c_uint64 * t.ndim)(*t.shape)
        s = lib.H5Screate_simple(t.ndim, dims, None)
        d = lib.H5Dcreate2(hid(g), nom.encode(), hid(genre), hid(s), hid(0), hid(0), hid(0))
        assert d >= 0
        assert lib.H5Dwrite(hid(d), hid(genre), hid(s), hid(0), hid(0), t.ctypes.data_as(ctypes.c_void_p)) >= 0
        lib.H5Dclose(hid(d)); lib.H5Sclose(hid(s)); lib.H5Gclose(hid(g)); lib.H5Fclose(hid(f))

    def attribut(ou, nom, tableau, genre):
        f = lib.H5Fopen(b, 1, hid(0))
        o = lib.H5Oopen(hid(f), ou.encode(), hid(0))
        t = np.ascontiguousarray(tableau)
        dims = (ctypes.c_uint64 * 1)(t.size)
        s = lib.H5Screate_simple(1, dims, None)
        a = lib.H5Acreate2(hid(o), nom.encode(), hid(genre), hid(s), hid(0), hid(0))
        assert a >= 0
        assert lib.H5Awrite(hid(a), hid(genre), t.ctypes.data_as(ctypes.c_void_p)) >= 0
        lib.H5Aclose(hid(a)); lib.H5Sclose(hid(s)); lib.H5Oclose(hid(o)); lib.H5Fclose(hid(f))

    theta, phi, e_t, e_p, p_rad, dmax, prad = champs(graine)
    donnees("/Mesh", "theta", theta, FLOAT)
    donnees("/Mesh", "phi", phi, FLOAT)
    donnees("/Mesh", "r", np.array([1.0], np.float32), FLOAT)
    attribut("/Mesh", "MeshType", np.array([2.0], np.float32), FLOAT)
    # [phi][theta] : c'est l'ordre du fichier, que nf2ff.py retourne par swapaxes
    for nom, e in (("E_theta", e_t), ("E_phi", e_p)):
        donnees("/nf2ff/%s/FD" % nom, "f0_real", e.real.T.copy(), DOUBLE)
        donnees("/nf2ff/%s/FD" % nom, "f0_imag", e.imag.T.copy(), DOUBLE)
    donnees("/nf2ff/P_rad/FD", "f0", p_rad.T.copy(), DOUBLE)
    attribut("/nf2ff", "Frequency", np.array([freq], np.float32), FLOAT)
    attribut("/nf2ff", "Prad", np.array([prad]), DOUBLE)
    attribut("/nf2ff", "Dmax", np.array([dmax]), DOUBLE)


if __name__ == "__main__":
    ecrire(sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else 1)
