package com.mainefarmmarket.app;

import android.Manifest;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

@CapacitorPlugin(
    name = "LocationPermission",
    permissions = {
        @Permission(
            alias = "coarseLocation",
            strings = {Manifest.permission.ACCESS_COARSE_LOCATION}
        ),
        @Permission(
            alias = "fineLocation",
            strings = {Manifest.permission.ACCESS_FINE_LOCATION}
        )
    }
)
public class LocationPermissionPlugin extends Plugin {
    @PluginMethod
    public void ensurePermission(PluginCall call) {
        if (hasAnyLocationPermission()) {
            call.resolve();
            return;
        }
        requestPermissionForAliases(
            new String[] {"coarseLocation", "fineLocation"},
            call,
            "locationPermissionCallback"
        );
    }

    @PermissionCallback
    private void locationPermissionCallback(PluginCall call) {
        if (hasAnyLocationPermission()) {
            call.resolve();
            return;
        }
        call.reject(
            "Location permission was not granted.",
            "LOCATION_PERMISSION_DENIED"
        );
    }

    private boolean hasAnyLocationPermission() {
        return getPermissionState("coarseLocation") == PermissionState.GRANTED
            || getPermissionState("fineLocation") == PermissionState.GRANTED;
    }
}
